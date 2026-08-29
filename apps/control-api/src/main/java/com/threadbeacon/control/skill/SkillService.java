package com.threadbeacon.control.skill;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.node.WorkerNode;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static com.threadbeacon.control.common.Values.*;

@Service
public class SkillService {
    private static final int FAILURE_THRESHOLD = 3;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final MeterRegistry metrics;

    public SkillService(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper mapper,
            MeterRegistry metrics
    ) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper;
        this.metrics = metrics;
    }

    public List<Map<String, Object>> list(String ownerId) {
        return jdbc.queryForList("""
                SELECT s.*,
                  (SELECT count(*) FROM skill_runs r WHERE r.skill_id=s.id) AS run_count,
                  (SELECT count(*) FROM skill_runs r WHERE r.skill_id=s.id AND r.status='succeeded') AS success_count,
                  EXISTS(SELECT 1 FROM skill_corrections c WHERE c.skill_id=s.id AND c.status='proposed') AS correction_pending
                FROM skills s WHERE s.owner_id=? ORDER BY s.updated_at DESC
                """, ownerId);
    }

    public Map<String, Object> get(String ownerId, String skillId) {
        var skill = skill(ownerId, skillId);
        var result = new LinkedHashMap<String, Object>();
        result.put("skill", skill);
        result.put("versions", jdbc.queryForList(
                "SELECT * FROM skill_versions WHERE skill_id=? ORDER BY version DESC", skillId));
        result.put("runs", jdbc.queryForList(
                "SELECT * FROM skill_runs WHERE skill_id=? AND owner_id=? ORDER BY started_at DESC LIMIT 100",
                skillId, ownerId));
        result.put("evidence", jdbc.queryForList(
                "SELECT * FROM skill_evidence WHERE skill_id=? ORDER BY created_at DESC LIMIT 200", skillId));
        result.put("corrections", jdbc.queryForList(
                "SELECT * FROM skill_corrections WHERE skill_id=? ORDER BY created_at DESC", skillId));
        result.put("reviews", jdbc.queryForList("""
                SELECT v.*,r.status AS run_status,r.task_text FROM skill_action_reviews v
                JOIN skill_runs r ON r.id=v.run_id WHERE r.skill_id=? ORDER BY v.requested_at DESC
                """, skillId));
        return result;
    }

    public Map<String, Object> create(String ownerId, Map<String, Object> body) {
        var domain = identifier(body.get("domain"), "domain");
        var capability = identifier(body.get("capability"), "capability");
        var name = required(body.get("name"), 255, "Skill name");
        var scope = limited(body.get("scope"), 2000, "Skill scope");
        var skillMd = required(body.get("skillMd"), 100_000, "SKILL.md");
        var elements = SkillElements.from(body.get("elements"));
        var skillId = id();
        var versionId = id();
        var timestamp = now();
        var elementsJson = json(mapper, elements.asMap());
        var sourceTrace = nullable(body.get("sourceTrace"));
        var distillModel = nullable(body.get("distillModel"));

        try {
            transactions.executeWithoutResult(status -> {
                jdbc.update("""
                        INSERT INTO skills(id,owner_id,domain,capability,name,scope,skill_md,elements_json,status,current_version,enabled,source_trace,distill_model,created_at,updated_at)
                        VALUES(?,?,?,?,?,?,?,?,'draft',1,1,?,?,?,?)
                        """, skillId, ownerId, domain, capability, name, scope, skillMd, elementsJson,
                        sourceTrace, distillModel, timestamp, timestamp);
                jdbc.update("""
                        INSERT INTO skill_versions(id,skill_id,version,name,scope,skill_md,elements_json,source_trace,distill_model,change_reason,created_by,created_at)
                        VALUES(?,?,1,?,?,?,?,?,?, 'initial-distill',?,?)
                        """, versionId, skillId, name, scope, skillMd, elementsJson,
                        sourceTrace, distillModel, ownerId, timestamp);
                evidence(skillId, null, "distilled", null,
                        Map.of("version", 1, "sourceTrace", sourceTrace == null ? "" : sourceTrace), timestamp);
                audit(ownerId, "skill.create", "skill", skillId,
                        Map.of("domain", domain, "capability", capability, "version", 1), timestamp);
            });
        } catch (DuplicateKeyException conflict) {
            throw new ApiException(HttpStatus.CONFLICT, "相同 domain/capability 的 Skill 已存在");
        }
        return skill(ownerId, skillId);
    }

    public Map<String, Object> publish(String ownerId, String skillId) {
        var timestamp = now();
        var updated = jdbc.update("""
                UPDATE skills SET status='active',updated_at=?
                WHERE id=? AND owner_id=? AND status IN ('draft','active')
                """, timestamp, skillId, ownerId);
        if (updated != 1) throw new ApiException(HttpStatus.NOT_FOUND, "Skill 不存在或不可发布");
        var skill = skill(ownerId, skillId);
        evidence(skillId, null, "published", null,
                Map.of("version", integer(skill.get("current_version"), 1)), timestamp);
        audit(ownerId, "skill.publish", "skill", skillId,
                Map.of("version", integer(skill.get("current_version"), 1)), timestamp);
        return skill;
    }

    public Map<String, Object> startRun(String ownerId, String skillId, Map<String, Object> body) {
        return createQueuedRun(ownerId, skillId, body, null);
    }

    public Map<String, Object> startWorkflowRun(
            String ownerId,
            String skillId,
            String workflowRunId,
            String workflowNodeId,
            Map<String, Object> body
    ) {
        var input = new LinkedHashMap<>(body);
        input.put("workflowRunId", workflowRunId);
        input.put("workflowNodeId", workflowNodeId);
        return createQueuedRun(ownerId, skillId, input, workflowNodeId);
    }

    private Map<String, Object> createQueuedRun(
            String ownerId,
            String skillId,
            Map<String, Object> body,
            String workflowNodeId
    ) {
        var skill = skill(ownerId, skillId);
        if (!"active".equals(text(skill.get("status"))) || integer(skill.get("enabled"), 0) != 1) {
            throw new ApiException(HttpStatus.CONFLICT, "Skill 尚未发布或已停用");
        }
        var task = required(body.get("task"), 10_000, "Skill task");
        var workflowRunId = nullable(body.get("workflowRunId"));
        if (workflowRunId != null && jdbc.queryForObject(
                "SELECT count(*) FROM workflow_runs WHERE id=? AND owner_id=?", Integer.class,
                workflowRunId, ownerId) != 1) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "workflowRunId 不属于当前工作区");
        }
        var runId = id();
        var timestamp = now();
        var context = object(body.get("context"));
        var contextJson = json(mapper, context);
        if (contextJson.length() > 500_000) throw new ApiException(HttpStatus.BAD_REQUEST, "Skill context 超过 500 KiB");
        var maxSteps = Math.max(1, Math.min(50, integer(body.get("maxSteps"), 10)));
        var allowlist = normalizedAllowlist(body.get("allowlist"), text(skill.get("domain")));
        jdbc.update("""
                INSERT INTO skill_runs(id,skill_id,skill_version,owner_id,workflow_run_id,workflow_node_id,status,task_text,context_json,max_steps,allowlist_json,started_at,updated_at)
                VALUES(?,?,?,?,?,?,'queued',?,?,?,?,?,?)
                """, runId, skillId, integer(skill.get("current_version"), 1), ownerId,
                workflowRunId, workflowNodeId, task, contextJson, maxSteps,
                json(mapper, allowlist), timestamp, timestamp);
        jdbc.update("INSERT INTO skill_run_events(id,run_id,sequence,type,payload_json,created_at) VALUES(?,?,0,'started',?,?)",
                id(), runId, json(mapper, Map.of("task", task)), timestamp);
        metrics.counter("threadbeacon.skill.runs.started").increment();
        return run(ownerId, runId);
    }

    public Map<String, Object> appendEvent(
            String ownerId,
            String runId,
            Map<String, Object> body
    ) {
        var type = text(body.get("type"));
        if (!List.of("perception", "proposal", "confirmation", "action", "tool_result", "state", "done", "error").contains(type)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Skill event type 无效");
        }
        var sequence = integer(body.get("sequence"), -1);
        if (sequence < 1) throw new ApiException(HttpStatus.BAD_REQUEST, "Skill event sequence 必须从 1 开始");
        var payload = object(body.get("payload"));
        try {
            var changed = jdbc.update("""
                    INSERT INTO skill_run_events(id,run_id,sequence,type,payload_json,created_at)
                    SELECT ?,?,?,?,?,? FROM skill_runs
                    WHERE id=? AND owner_id=? AND status='running'
                    """, id(), runId, sequence, type, json(mapper, payload), now(), runId, ownerId);
            if (changed != 1) throw new ApiException(HttpStatus.CONFLICT, "Skill run 不存在或已经终止");
        } catch (DuplicateKeyException conflict) {
            throw new ApiException(HttpStatus.CONFLICT, "Skill event sequence 重复");
        }
        return Map.of("ok", true, "sequence", sequence);
    }

    public Map<String, Object> claim(WorkerNode node) {
        if (!node.capabilities().contains("agent-skill") || node.activeJobs() >= node.maxConcurrency()) return null;
        return transactions.execute(status -> {
            var timestamp = now();
            jdbc.update("""
                    UPDATE skill_runs SET status='queued',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
                      last_error='Agent Worker 租约过期，已重新排队',updated_at=?
                    WHERE status='running' AND lease_expires_at<? AND attempt<max_attempts
                    """, timestamp, timestamp);
            jdbc.update("""
                    UPDATE skill_runs SET status='failed',finished_at=?,lease_owner=NULL,lease_token=NULL,
                      lease_expires_at=NULL,last_error='Agent Worker 租约耗尽',updated_at=?
                    WHERE status='running' AND lease_expires_at<? AND attempt>=max_attempts
                    """, timestamp, timestamp, timestamp);
            var candidates = jdbc.queryForList("""
                    SELECT r.id FROM skill_runs r JOIN skills s ON s.id=r.skill_id
                    WHERE r.status='queued' AND s.status='active' AND s.enabled=1
                    ORDER BY r.started_at FOR UPDATE OF r SKIP LOCKED LIMIT 1
                    """);
            if (candidates.isEmpty()) return null;
            var runId = text(candidates.get(0).get("id"));
            var leaseToken = id();
            var changed = jdbc.update("""
                    UPDATE skill_runs SET status='running',attempt=attempt+1,lease_owner=?,lease_token=?,
                      lease_expires_at=?,last_error=NULL,updated_at=? WHERE id=? AND status='queued'
                    """, node.id(), leaseToken, Instant.now().plus(60, ChronoUnit.SECONDS).toString(),
                    timestamp, runId);
            if (changed != 1) throw new ApiException(HttpStatus.CONFLICT, "Skill run 已被其他 Worker 获取");
            var result = new LinkedHashMap<>(jdbc.queryForMap("""
                    SELECT r.*,s.domain,s.capability,s.name AS skill_name,s.scope,s.skill_md,s.elements_json
                    FROM skill_runs r JOIN skills s ON s.id=r.skill_id WHERE r.id=?
                    """, runId));
            result.put("events", jdbc.queryForList(
                    "SELECT sequence,type,payload_json,created_at FROM skill_run_events WHERE run_id=? ORDER BY sequence", runId));
            result.put("leaseToken", leaseToken);
            return result;
        });
    }

    public Map<String, Object> pauseForConfirmation(WorkerNode node, String runId, Map<String, Object> body) {
        return transactions.execute(status -> {
            var run = leasedRun(node, runId);
            appendAgentEvents(runId, body.get("events"));
            var action = object(body.get("action"));
            var element = object(body.get("element"));
            if (action.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "确认提案缺少 action");
            var elements = SkillElements.from(parseMap(run.get("elements_json")));
            var decision = SkillRiskPolicy.classify(action, element, elements);
            if (!decision.needsConfirm()) throw new ApiException(HttpStatus.BAD_REQUEST, "低风险动作不应进入人工确认");
            if (decision.matchedRedLine() != null) throw new ApiException(HttpStatus.CONFLICT, "动作命中 Skill 红线，禁止批准");
            var risk = Map.<String, Object>of(
                    "tier", decision.tier().name().toLowerCase(), "reason", decision.reason(),
                    "matchedRedLine", decision.matchedRedLine() == null ? "" : decision.matchedRedLine());
            var sequence = nextSequence(runId);
            var reviewId = id(); var timestamp = now();
            jdbc.update("""
                    INSERT INTO skill_action_reviews(id,run_id,sequence,status,action_json,risk_json,requested_at)
                    VALUES(?,?,?,'pending',?,?,?)
                    """, reviewId, runId, sequence, json(mapper, action), json(mapper, risk), timestamp);
            jdbc.update("""
                    UPDATE skill_runs SET status='awaiting_confirmation',proposed_action_json=?,agent_state_json=?,
                      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?
                    """, json(mapper, action), json(mapper, object(body.get("state"))), timestamp, runId);
            jdbc.update("INSERT INTO skill_run_events(id,run_id,sequence,type,payload_json,created_at) VALUES(?,?,?,'confirmation',?,?)",
                    id(), runId, sequence, json(mapper, Map.of("reviewId", reviewId, "status", "pending", "risk", risk)), timestamp);
            metrics.counter("threadbeacon.skill.confirmations.requested").increment();
            return run(text(run.get("owner_id")), runId);
        });
    }

    public Map<String, Object> resolveReview(String ownerId, String runId, String reviewId, boolean approved) {
        return transactions.execute(status -> {
            var rows = jdbc.queryForList("""
                    SELECT v.*,r.owner_id,r.workflow_run_id,r.workflow_node_id
                    FROM skill_action_reviews v JOIN skill_runs r ON r.id=v.run_id
                    WHERE v.id=? AND v.run_id=? AND r.owner_id=? AND v.status='pending'
                    FOR UPDATE OF v,r
                    """, reviewId, runId, ownerId);
            if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "待确认动作不存在");
            var review = rows.get(0); var timestamp = now();
            jdbc.update("UPDATE skill_action_reviews SET status=?,resolved_by=?,resolved_at=? WHERE id=?",
                    approved ? "approved" : "rejected", ownerId, timestamp, reviewId);
            if (approved) {
                jdbc.update("""
                        UPDATE skill_runs SET status='queued',confirmation_json=?,proposed_action_json=NULL,
                          updated_at=? WHERE id=? AND status='awaiting_confirmation'
                        """, json(mapper, Map.of("reviewId", reviewId, "action", parseMap(review.get("action_json")))),
                        timestamp, runId);
            } else {
                jdbc.update("""
                        UPDATE skill_runs SET status='failed',outcome_json=?,self_eval_json=?,proposed_action_json=NULL,
                          finished_at=?,updated_at=? WHERE id=? AND status='awaiting_confirmation'
                        """, json(mapper, Map.of("status", "failed", "loop_outcome", "human_rejected")),
                        json(mapper, Map.of("passed", false, "outcome", "human_rejected")), timestamp, timestamp, runId);
            }
            var sequence = nextSequence(runId);
            jdbc.update("INSERT INTO skill_run_events(id,run_id,sequence,type,payload_json,created_at) VALUES(?,?,?,'confirmation',?,?)",
                    id(), runId, sequence, json(mapper, Map.of("reviewId", reviewId, "status", approved ? "approved" : "rejected")), timestamp);
            audit(ownerId, approved ? "skill.confirm" : "skill.reject", "skill_run", runId,
                    Map.of("reviewId", reviewId), timestamp);
            metrics.counter("threadbeacon.skill.confirmations.resolved", "decision", approved ? "approved" : "rejected").increment();
            return run(ownerId, runId);
        });
    }

    public Map<String, Object> completeFromWorker(WorkerNode node, String runId, Map<String, Object> body) {
        var run = leasedRun(node, runId);
        appendAgentEvents(runId, body.get("events"));
        var outcome = new LinkedHashMap<>(object(body.get("outcome")));
        if (outcome.isEmpty()) outcome.put("loopOutcome", "error");
        if (body.containsKey("state")) {
            jdbc.update("UPDATE skill_runs SET agent_state_json=? WHERE id=?", json(mapper, object(body.get("state"))), runId);
        }
        return completeRun(text(run.get("owner_id")), runId, outcome);
    }

    public Map<String, Object> failFromWorker(WorkerNode node, String runId, String error) {
        return transactions.execute(status -> {
            var run = leasedRun(node, runId); var timestamp = now();
            var retry = integer(run.get("attempt"), 0) < integer(run.get("max_attempts"), 3);
            jdbc.update("""
                    UPDATE skill_runs SET status=?,last_error=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
                      finished_at=CASE WHEN ?='failed' THEN ? ELSE NULL END,updated_at=? WHERE id=?
                    """, retry ? "queued" : "failed", error.substring(0, Math.min(2000, error.length())),
                    retry ? "queued" : "failed", timestamp, timestamp, runId);
            var sequence = nextSequence(runId);
            jdbc.update("INSERT INTO skill_run_events(id,run_id,sequence,type,payload_json,created_at) VALUES(?,?,?,'error',?,?)",
                    id(), runId, sequence, json(mapper, Map.of("message", error.substring(0, Math.min(1000, error.length())), "retryable", retry)), timestamp);
            metrics.counter("threadbeacon.skill.worker.failures", "retryable", Boolean.toString(retry)).increment();
            return run(text(run.get("owner_id")), runId);
        });
    }

    public Map<String, Object> completeRun(String ownerId, String runId, Map<String, Object> body) {
        return transactions.execute(status -> {
            var rows = jdbc.queryForList("""
                    SELECT r.*,s.domain,s.capability,s.elements_json
                    FROM skill_runs r JOIN skills s ON s.id=r.skill_id
                    WHERE r.id=? AND r.owner_id=? FOR UPDATE OF r,s
                    """, runId, ownerId);
            if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "Skill run 不存在");
            var run = rows.get(0);
            if (!"running".equals(text(run.get("status")))) {
                throw new ApiException(HttpStatus.CONFLICT, "Skill run 已经终止");
            }
            var elements = SkillElements.from(parseMap(run.get("elements_json")));
            var outcome = SkillTrace.normalizeOutcome(body);
            var trace = SkillTrace.assemble(runId, text(run.get("domain")),
                    text(run.get("capability")), eventSteps(runId), outcome);
            var evaluation = SkillTrace.evaluate(runId, outcome, elements);
            var passed = Boolean.TRUE.equals(evaluation.get("passed"));
            var runStatus = switch (text(outcome.get("status"))) {
                case "success" -> "succeeded";
                case "paused" -> "paused";
                default -> "failed";
            };
            var proposedAction = object(body.get("proposedAction"));
            var timestamp = now();
            jdbc.update("""
                    UPDATE skill_runs SET status=?,trace_json=?,outcome_json=?,self_eval_json=?,proposed_action_json=?,finished_at=?,
                      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,confirmation_json=NULL,updated_at=?
                    WHERE id=? AND status='running'
                    """, runStatus, json(mapper, trace), json(mapper, outcome), json(mapper, evaluation),
                    proposedAction.isEmpty() ? null : json(mapper, proposedAction), timestamp, timestamp, runId);
            evidence(text(run.get("skill_id")), runId, "executed", passed,
                    evaluation, timestamp);
            if (!passed && !"error".equals(text(outcome.get("loop_outcome")))) {
                jdbc.update("UPDATE skills SET last_failing_trace_json=?,updated_at=? WHERE id=?",
                        json(mapper, trace), timestamp, run.get("skill_id"));
                proposeCorrectionIfNeeded(text(run.get("skill_id")),
                        integer(run.get("skill_version"), 1), timestamp);
            }
            metrics.counter("threadbeacon.skill.runs.completed", "status", runStatus).increment();
            return run(ownerId, runId);
        });
    }

    public Map<String, Object> applyCorrection(
            String ownerId,
            String skillId,
            String correctionId,
            Map<String, Object> body
    ) {
        return transactions.execute(status -> {
            var rows = jdbc.queryForList("""
                    SELECT c.*,s.owner_id,s.name,s.scope,s.current_version
                    FROM skill_corrections c JOIN skills s ON s.id=c.skill_id
                    WHERE c.id=? AND c.skill_id=? AND s.owner_id=? FOR UPDATE OF c,s
                    """, correctionId, skillId, ownerId);
            if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "Skill correction 不存在");
            var correction = rows.get(0);
            if (!"proposed".equals(text(correction.get("status")))) {
                throw new ApiException(HttpStatus.CONFLICT, "Skill correction 已处理");
            }
            var currentVersion = integer(correction.get("current_version"), 1);
            if (integer(body.get("expectedVersion"), -1) != currentVersion ||
                    integer(correction.get("from_version"), -1) != currentVersion) {
                throw new ApiException(HttpStatus.CONFLICT, "Skill 版本已变化，请重新评估 correction");
            }
            var name = body.containsKey("name")
                    ? required(body.get("name"), 255, "Skill name") : text(correction.get("name"));
            var scope = body.containsKey("scope")
                    ? limited(body.get("scope"), 2000, "Skill scope") : text(correction.get("scope"));
            var skillMd = required(body.get("skillMd"), 100_000, "SKILL.md");
            var elements = SkillElements.from(body.get("elements"));
            var elementsJson = json(mapper, elements.asMap());
            var nextVersion = jdbc.queryForObject(
                    "SELECT COALESCE(MAX(version),0)+1 FROM skill_versions WHERE skill_id=?",
                    Integer.class, skillId);
            if (nextVersion == null) throw new ApiException(HttpStatus.CONFLICT, "无法计算 Skill 版本");
            var timestamp = now();
            var model = nullable(body.get("distillModel"));
            jdbc.update("""
                    UPDATE skills SET name=?,scope=?,skill_md=?,elements_json=?,current_version=?,source_trace=?,distill_model=?,last_failing_trace_json=NULL,updated_at=?
                    WHERE id=?
                    """, name, scope, skillMd, elementsJson, nextVersion,
                    "correction:" + correctionId, model, timestamp, skillId);
            jdbc.update("""
                    INSERT INTO skill_versions(id,skill_id,version,name,scope,skill_md,elements_json,source_trace,distill_model,change_reason,created_by,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,'re-distill',?,?)
                    """, id(), skillId, nextVersion, name, scope, skillMd, elementsJson,
                    "correction:" + correctionId, model, ownerId, timestamp);
            jdbc.update("""
                    UPDATE skill_corrections SET status='applied',to_version=?,candidate_skill_md=?,candidate_elements_json=?,resolved_at=?
                    WHERE id=? AND status='proposed'
                    """, nextVersion, skillMd, elementsJson, timestamp, correctionId);
            evidence(skillId, null, "corrected", null,
                    Map.of("correctionId", correctionId, "fromVersion", currentVersion,
                            "toVersion", nextVersion), timestamp);
            audit(ownerId, "skill.correct", "skill", skillId,
                    Map.of("correctionId", correctionId, "fromVersion", currentVersion,
                            "toVersion", nextVersion), timestamp);
            metrics.counter("threadbeacon.skill.corrections.applied").increment();
            return skill(ownerId, skillId);
        });
    }

    public Map<String, Object> dismissCorrection(String ownerId, String skillId, String correctionId) {
        var timestamp = now();
        var changed = jdbc.update("""
                UPDATE skill_corrections SET status='dismissed',resolved_at=?
                WHERE id=? AND skill_id=? AND status='proposed'
                  AND EXISTS(SELECT 1 FROM skills s WHERE s.id=skill_id AND s.owner_id=?)
                """, timestamp, correctionId, skillId, ownerId);
        if (changed != 1) throw new ApiException(HttpStatus.NOT_FOUND, "待处理 correction 不存在");
        evidence(skillId, null, "correction_dismissed", null,
                Map.of("correctionId", correctionId), timestamp);
        return skill(ownerId, skillId);
    }

    public Map<String, Object> rollback(String ownerId, String skillId, String correctionId) {
        return transactions.execute(status -> {
            var corrections = jdbc.queryForList("""
                    SELECT c.* FROM skill_corrections c JOIN skills s ON s.id=c.skill_id
                    WHERE c.id=? AND c.skill_id=? AND c.status='applied' AND s.owner_id=? FOR UPDATE OF c,s
                    """, correctionId, skillId, ownerId);
            if (corrections.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "可回滚 correction 不存在");
            var correction = corrections.get(0);
            var previous = jdbc.queryForMap(
                    "SELECT * FROM skill_versions WHERE skill_id=? AND version=?",
                    skillId, correction.get("from_version"));
            var timestamp = now();
            jdbc.update("""
                    UPDATE skills SET name=?,scope=?,skill_md=?,elements_json=?,current_version=?,source_trace=?,distill_model=?,updated_at=?
                    WHERE id=?
                    """, previous.get("name"), previous.get("scope"), previous.get("skill_md"),
                    previous.get("elements_json"), previous.get("version"), previous.get("source_trace"),
                    previous.get("distill_model"), timestamp, skillId);
            jdbc.update("UPDATE skill_corrections SET status='rolled_back',resolved_at=? WHERE id=?",
                    timestamp, correctionId);
            evidence(skillId, null, "rolled_back", null,
                    Map.of("correctionId", correctionId, "fromVersion", correction.get("to_version"),
                            "toVersion", correction.get("from_version")), timestamp);
            audit(ownerId, "skill.rollback", "skill", skillId,
                    Map.of("correctionId", correctionId), timestamp);
            metrics.counter("threadbeacon.skill.corrections.rolled_back").increment();
            return skill(ownerId, skillId);
        });
    }

    public Map<String, Object> run(String ownerId, String runId) {
        var rows = jdbc.queryForList("SELECT * FROM skill_runs WHERE id=? AND owner_id=?", runId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "Skill run 不存在");
        var result = new LinkedHashMap<String, Object>(rows.get(0));
        result.put("events", jdbc.queryForList(
                "SELECT * FROM skill_run_events WHERE run_id=? ORDER BY sequence", runId));
        result.put("reviews", jdbc.queryForList(
                "SELECT * FROM skill_action_reviews WHERE run_id=? ORDER BY sequence", runId));
        return result;
    }

    private void proposeCorrectionIfNeeded(String skillId, int currentVersion, String timestamp) {
        var open = jdbc.queryForObject(
                "SELECT count(*) FROM skill_corrections WHERE skill_id=? AND status='proposed'",
                Integer.class, skillId);
        if (open != null && open > 0) return;
        var proposal = SkillCorrectionPolicy.evaluate(loadEvidence(skillId), FAILURE_THRESHOLD);
        if (!proposal.required()) return;
        var correctionId = id();
        jdbc.update("""
                INSERT INTO skill_corrections(id,skill_id,status,from_version,reason,trace_ids_json,created_at)
                VALUES(?,?,'proposed',?,'three-consecutive-skill-failures',?,?)
                """, correctionId, skillId, currentVersion, json(mapper, proposal.traceIds()), timestamp);
        evidence(skillId, null, "correction_proposed", null,
                Map.of("correctionId", correctionId, "traceIds", proposal.traceIds(),
                        "fromVersion", currentVersion), timestamp);
        metrics.counter("threadbeacon.skill.corrections.proposed").increment();
    }

    private List<Map<String, Object>> loadEvidence(String skillId) {
        var rows = jdbc.queryForList("""
                SELECT event_type,passed,payload_json FROM skill_evidence
                WHERE skill_id=? ORDER BY created_at,id
                """, skillId);
        var result = new ArrayList<Map<String, Object>>();
        for (var row : rows) {
            var item = new LinkedHashMap<String, Object>();
            item.put("event_type", row.get("event_type"));
            item.put("passed", integer(row.get("passed"), -1) == 1);
            item.put("payload", parseMap(row.get("payload_json")));
            result.add(item);
        }
        return result;
    }

    private List<Map<String, Object>> eventSteps(String runId) {
        var rows = jdbc.queryForList("""
                SELECT sequence,type,payload_json,created_at FROM skill_run_events
                WHERE run_id=? ORDER BY sequence
                """, runId);
        var steps = new ArrayList<Map<String, Object>>();
        for (var row : rows) {
            if ("started".equals(row.get("type"))) continue;
            var step = new LinkedHashMap<String, Object>();
            step.put("sequence", row.get("sequence"));
            step.put("type", row.get("type"));
            step.put("payload", parseMap(row.get("payload_json")));
            step.put("at", row.get("created_at"));
            steps.add(step);
        }
        return steps;
    }

    private Map<String, Object> leasedRun(WorkerNode node, String runId) {
        var rows = jdbc.queryForList("""
                SELECT r.*,s.elements_json FROM skill_runs r JOIN skills s ON s.id=r.skill_id
                WHERE r.id=? AND r.lease_owner=? AND r.status='running' AND r.lease_expires_at>?
                """, runId, node.id(), now());
        if (rows.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "Skill run Worker 租约无效或已过期");
        return rows.get(0);
    }

    private void appendAgentEvents(String runId, Object input) {
        if (!(input instanceof List<?> values)) return;
        if (values.size() > 100) throw new ApiException(HttpStatus.BAD_REQUEST, "单次最多提交 100 个 Agent 事件");
        var allowed = List.of("perception", "proposal", "action", "tool_result", "state", "done", "error");
        var sequence = nextSequence(runId);
        for (var value : values) {
            var event = object(value); var type = text(event.get("type"));
            if (!allowed.contains(type)) throw new ApiException(HttpStatus.BAD_REQUEST, "Agent 事件类型无效：" + type);
            jdbc.update("INSERT INTO skill_run_events(id,run_id,sequence,type,payload_json,created_at) VALUES(?,?,?,?,?,?)",
                    id(), runId, sequence++, type, json(mapper, object(event.get("payload"))), now());
        }
    }

    private int nextSequence(String runId) {
        var next = jdbc.queryForObject("SELECT COALESCE(MAX(sequence),0)+1 FROM skill_run_events WHERE run_id=?", Integer.class, runId);
        return next == null ? 1 : next;
    }

    private List<String> normalizedAllowlist(Object input, String domain) {
        var values = input instanceof List<?> list
                ? list.stream().filter(String.class::isInstance).map(String.class::cast).map(String::trim)
                    .map(String::toLowerCase).filter(value -> !value.isBlank()).distinct().toList()
                : List.<String>of();
        if (values.isEmpty() && !domain.isBlank()) values = List.of(domain.toLowerCase());
        if (values.size() > 100 || values.stream().anyMatch(value -> {
            var host = value.startsWith("*.") ? value.substring(2) : value;
            return host.isBlank() || host.equals("localhost") || host.endsWith(".local") || !host.matches("^[a-z0-9.-]+$");
        })) throw new ApiException(HttpStatus.BAD_REQUEST, "Skill allowlist 无效");
        return values;
    }

    private Map<String, Object> skill(String ownerId, String skillId) {
        var rows = jdbc.queryForList("SELECT * FROM skills WHERE id=? AND owner_id=?", skillId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "Skill 不存在");
        return rows.get(0);
    }

    private Map<String, Object> parseMap(Object value) {
        if (!(value instanceof String textValue) || textValue.isBlank()) return Map.of();
        try {
            return mapper.readValue(textValue, new TypeReference<>() {});
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private void evidence(
            String skillId,
            String runId,
            String eventType,
            Boolean passed,
            Map<String, Object> payload,
            String timestamp
    ) {
        jdbc.update("""
                INSERT INTO skill_evidence(id,skill_id,run_id,event_type,passed,payload_json,created_at)
                VALUES(?,?,?,?,?,?,?)
                """, id(), skillId, runId, eventType, passed == null ? null : passed ? 1 : 0,
                json(mapper, payload), timestamp);
    }

    private void audit(
            String ownerId,
            String action,
            String resourceType,
            String resourceId,
            Map<String, Object> detail,
            String timestamp
    ) {
        jdbc.update("""
                INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                VALUES(?,?,?,?,?,?,?)
                """, id(), ownerId, action, resourceType, resourceId, json(mapper, detail), timestamp);
    }

    private String identifier(Object value, String label) {
        var result = text(value).toLowerCase();
        if (!result.matches("^[a-z0-9][a-z0-9.-]{0,99}$")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, label + " 格式无效");
        }
        return result;
    }

    private String required(Object value, int max, String label) {
        var result = text(value);
        if (result.isBlank() || result.length() > max) {
            throw new ApiException(HttpStatus.BAD_REQUEST, label + " 为空或超过长度限制");
        }
        return result;
    }

    private String limited(Object value, int max, String label) {
        var result = text(value);
        if (result.length() > max) throw new ApiException(HttpStatus.BAD_REQUEST, label + " 超过长度限制");
        return result;
    }

    private String nullable(Object value) {
        var result = text(value);
        return result.isBlank() ? null : result;
    }
}
