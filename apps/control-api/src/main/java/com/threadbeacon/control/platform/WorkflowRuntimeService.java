package com.threadbeacon.control.platform;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.Values;
import com.threadbeacon.control.skill.SkillService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.*;

/** Durable DAG finalizer. Sources and Agent Skills are real async boundaries; deterministic nodes advance here. */
@Service
public class WorkflowRuntimeService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final SkillService skills;
    private final MeterRegistry metrics;

    public WorkflowRuntimeService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper mapper,
                                  SkillService skills, MeterRegistry metrics) {
        this.jdbc = jdbc; this.transactions = transactions; this.mapper = mapper;
        this.skills = skills; this.metrics = metrics;
    }

    public void sourcesReady(String runId) {
        advance(runId);
    }

    public void skillPaused(String workflowRunId) {
        if (workflowRunId == null || workflowRunId.isBlank()) return;
        jdbc.update("UPDATE workflow_runs SET status='awaiting_confirmation',updated_at=? WHERE id=? AND status NOT IN ('failed','completed')",
                now(), workflowRunId);
    }

    public void skillResumed(String workflowRunId) {
        if (workflowRunId == null || workflowRunId.isBlank()) return;
        jdbc.update("UPDATE workflow_runs SET status='running',updated_at=? WHERE id=? AND status='awaiting_confirmation'",
                now(), workflowRunId);
    }

    public void skillFinished(String workflowRunId, String nodeId, String status, Object output) {
        if (workflowRunId == null || workflowRunId.isBlank() || nodeId == null || nodeId.isBlank()) return;
        var timestamp = now();
        var checkpointStatus = "succeeded".equals(status) ? "completed" : "failed";
        jdbc.update("""
                UPDATE workflow_checkpoints SET status=?,output_json=?,finished_at=?,updated_at=?
                WHERE run_id=? AND node_id=?
                """, checkpointStatus, json(mapper, output), timestamp, timestamp, workflowRunId, nodeId);
        event(workflowRunId, nodeId, checkpointStatus,
                "succeeded".equals(status) ? "Agent Skill 执行完成" : "Agent Skill 执行失败", Map.of("skillStatus", status));
        if (!"succeeded".equals(status)) {
            jdbc.update("UPDATE workflow_runs SET status='failed',last_error='Agent Skill 执行失败',finished_at=?,updated_at=? WHERE id=?",
                    timestamp, timestamp, workflowRunId);
            metrics.counter("threadbeacon.workflow.completed", "status", "failed").increment();
            return;
        }
        advance(workflowRunId);
    }

    public void advance(String runId) {
        transactions.executeWithoutResult(ignored -> advanceLocked(runId));
    }

    private void advanceLocked(String runId) {
        var rows = jdbc.queryForList("""
                SELECT r.*,v.spec_json FROM workflow_runs r JOIN workflow_versions v ON v.id=r.version_id
                WHERE r.id=? FOR UPDATE OF r
                """, runId);
        if (rows.isEmpty()) return;
        var run = rows.get(0);
        if (List.of("failed", "completed", "cancelled").contains(text(run.get("status")))) return;
        var spec = parseMap(run.get("spec_json"));
        WorkflowSpecPolicy.validate(spec);
        var nodes = array(spec.get("nodes")).stream().map(Values::object).toList();
        var parents = new HashMap<String, List<String>>();
        for (var edgeValue : array(spec.get("edges"))) {
            var edge = object(edgeValue);
            parents.computeIfAbsent(text(edge.get("target")), _key -> new ArrayList<>()).add(text(edge.get("source")));
        }
        var progressed = true;
        while (progressed) {
            progressed = false;
            var checkpoints = checkpoints(runId);
            for (var node : nodes) {
                var nodeId = text(node.get("id")); var type = text(node.get("type"));
                var checkpoint = checkpoints.get(nodeId);
                if (checkpoint == null || !"pending".equals(text(checkpoint.get("status"))) || "source".equals(type)) continue;
                var upstream = parents.getOrDefault(nodeId, List.of());
                var upstreamStates = upstream.stream().map(id -> text(checkpoints.getOrDefault(id, Map.of()).get("status"))).toList();
                if (upstreamStates.stream().anyMatch(value -> List.of("failed", "blocked", "skipped").contains(value))) {
                    finishCheckpoint(runId, nodeId, "skipped", Map.of("reason", "upstream-not-completed"));
                    progressed = true; continue;
                }
                if (upstreamStates.stream().anyMatch(value -> !"completed".equals(value))) continue;
                var config = object(node.get("config"));
                if ("agent".equals(type)) {
                    var skillId = text(config.get("skillId"));
                    var task = text(config.get("instructions"));
                    if (task.isBlank()) task = text(node.get("label"));
                    if (task.isBlank()) task = "按照绑定 Skill 完成研究任务";
                    var context = context(runId, upstream, checkpoints);
                    var body = new LinkedHashMap<String, Object>();
                    body.put("task", task); body.put("context", context);
                    body.put("maxSteps", Math.max(1, Math.min(50, integer(config.get("maxIterations"), 10))));
                    body.put("allowlist", config.getOrDefault("allowlist", List.of()));
                    var skillRun = skills.startWorkflowRun(text(run.get("owner_id")), skillId, runId, nodeId, body);
                    jdbc.update("UPDATE workflow_checkpoints SET status='queued',output_json=?,started_at=?,updated_at=? WHERE run_id=? AND node_id=? AND status='pending'",
                            json(mapper, Map.of("skillRunId", skillRun.get("id"))), now(), now(), runId, nodeId);
                    event(runId, nodeId, "queued", "Agent Skill 已进入执行队列", Map.of("skillRunId", skillRun.get("id"), "skillId", skillId));
                    progressed = true; continue;
                }
                var result = deterministicResult(type, config, runId, upstream, checkpoints);
                var nodeStatus = text(result.get("status"));
                finishCheckpoint(runId, nodeId, nodeStatus, result.get("output"));
                event(runId, nodeId, nodeStatus, text(result.get("message")), object(result.get("output")));
                progressed = true;
                if ("blocked".equals(nodeStatus)) {
                    jdbc.update("UPDATE workflow_runs SET status='failed',last_error=?,finished_at=?,updated_at=? WHERE id=?",
                            text(result.get("message")), now(), now(), runId);
                    metrics.counter("threadbeacon.workflow.completed", "status", "failed").increment();
                    return;
                }
            }
        }
        var checkpoints = checkpoints(runId);
        var statuses = checkpoints.values().stream().map(value -> text(value.get("status"))).toList();
        var timestamp = now();
        if (statuses.stream().allMatch(value -> List.of("completed", "skipped").contains(value))) {
            jdbc.update("UPDATE workflow_runs SET status='completed',result_json=?,finished_at=?,updated_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
                    json(mapper, Map.of("checkpoints", checkpoints.size(), "status", "completed")), timestamp, timestamp, runId);
            event(runId, "runtime", "completed", "工作流所有节点执行完成", Map.of("checkpointCount", checkpoints.size()));
            metrics.counter("threadbeacon.workflow.completed", "status", "completed").increment();
        } else if (statuses.stream().anyMatch("queued"::equals) || statuses.stream().anyMatch("running"::equals)) {
            jdbc.update("UPDATE workflow_runs SET status='running',updated_at=? WHERE id=?", timestamp, runId);
        }
    }

    private Map<String, Object> deterministicResult(String type, Map<String, Object> config, String runId,
                                                     List<String> upstream, Map<String, Map<String, Object>> checkpoints) {
        var context = context(runId, upstream, checkpoints);
        if ("gate".equals(type)) {
            var itemCount = integer(context.get("itemCount"), 0);
            var threshold = Math.max(0, integer(config.get("threshold"), integer(config.get("minItems"), 1)));
            var operator = text(config.get("operator"));
            var passed = switch (operator) { case "gt" -> itemCount > threshold; case "lt" -> itemCount < threshold;
                case "lte" -> itemCount <= threshold; case "eq" -> itemCount == threshold; default -> itemCount >= threshold; };
            if (!passed && !"continue".equals(text(config.get("onReject")))) {
                return Map.of("status", "skip".equals(text(config.get("onReject"))) ? "skipped" : "blocked",
                        "message", "质量闸门未通过", "output", Map.of("passed", false, "actual", itemCount, "threshold", threshold));
            }
            return Map.of("status", "completed", "message", passed ? "质量闸门已通过" : "质量闸门未通过，按配置继续",
                    "output", Map.of("passed", passed, "actual", itemCount, "threshold", threshold));
        }
        return Map.of("status", "completed", "message", type + " 节点完成",
                "output", Map.of("type", type, "upstream", upstream, "itemCount", context.get("itemCount")));
    }

    private Map<String, Object> context(String runId, List<String> upstream, Map<String, Map<String, Object>> checkpoints) {
        var reports = jdbc.queryForList("SELECT result_json FROM workflow_run_jobs WHERE run_id=? AND status='completed'", runId);
        var reportValues = reports.stream().map(row -> parseMap(row.get("result_json"))).toList();
        var itemCount = reportValues.stream().mapToInt(report -> array(report.get("items")).size()).sum();
        var upstreamOutputs = new LinkedHashMap<String, Object>();
        for (var nodeId : upstream) upstreamOutputs.put(nodeId, parseMap(checkpoints.getOrDefault(nodeId, Map.of()).get("output_json")));
        var result = new LinkedHashMap<String, Object>();
        result.put("itemCount", itemCount); result.put("upstream", upstreamOutputs);
        result.put("reports", reportValues.stream().map(report -> compactReport(report)).toList());
        return result;
    }

    private Map<String, Object> compactReport(Map<String, Object> report) {
        var result = new LinkedHashMap<String, Object>();
        result.put("keyword", report.getOrDefault("keyword", ""));
        result.put("dataQuality", report.getOrDefault("dataQuality", ""));
        result.put("stats", report.getOrDefault("stats", Map.of()));
        result.put("painPoints", array(report.get("painPoints")).stream().limit(20).toList());
        result.put("items", array(report.get("items")).stream().limit(100).toList());
        return result;
    }

    private Map<String, Map<String, Object>> checkpoints(String runId) {
        var result = new HashMap<String, Map<String, Object>>();
        for (var row : jdbc.queryForList("SELECT * FROM workflow_checkpoints WHERE run_id=?", runId)) result.put(text(row.get("node_id")), row);
        return result;
    }
    private void finishCheckpoint(String runId, String nodeId, String status, Object output) {
        jdbc.update("UPDATE workflow_checkpoints SET status=?,output_json=?,started_at=COALESCE(started_at,?),finished_at=?,updated_at=? WHERE run_id=? AND node_id=?",
                status, json(mapper, output == null ? Map.of() : output), now(), now(), now(), runId, nodeId);
    }
    private void event(String runId, String nodeId, String type, String message, Map<String, Object> payload) {
        jdbc.update("INSERT INTO workflow_events(id,run_id,node_id,type,message,payload_json,created_at) VALUES(?,?,?,?,?,?,?)",
                id(), runId, nodeId, type, message, json(mapper, payload), now());
    }
    private Map<String, Object> parseMap(Object value) {
        if (!(value instanceof String raw) || raw.isBlank()) return Map.of();
        try { return mapper.readValue(raw, new TypeReference<>() {}); }
        catch (Exception ignored) { return Map.of(); }
    }
}
