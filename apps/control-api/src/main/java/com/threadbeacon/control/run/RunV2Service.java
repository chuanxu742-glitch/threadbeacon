package com.threadbeacon.control.run;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.job.JobService;
import com.threadbeacon.control.project.ProjectV2Service;
import com.threadbeacon.control.workflow.WorkflowV2Service;
import com.threadbeacon.control.workspace.V2ApiException;
import com.threadbeacon.control.workspace.V2Cursor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static com.threadbeacon.control.common.Values.array;
import static com.threadbeacon.control.common.Values.bool;
import static com.threadbeacon.control.common.Values.hash;
import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

@Service
public class RunV2Service {
    private static final Pattern SECRET_KEY = Pattern.compile("(?:^|[-_])(password|passwd|secret|token|api[-_]?key|authorization|cookie|credential)(?:$|[-_])", Pattern.CASE_INSENSITIVE);
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final CurrentUser user;
    private final ProjectV2Service projects;
    private final WorkflowV2Service workflows;
    private final JobService jobs;

    public RunV2Service(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper mapper,
                        CurrentUser user, ProjectV2Service projects, WorkflowV2Service workflows, JobService jobs) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper;
        this.user = user;
        this.projects = projects;
        this.workflows = workflows;
        this.jobs = jobs;
    }

    public Map<String, Object> create(String versionId, Map<String, Object> body, String idempotencyKey) {
        var ownerId = user.ownerId();
        var version = workflows.versionById(versionId);
        var projectId = text(version.get("project_id"));
        if (projectId.isBlank()) throw new V2ApiException(HttpStatus.CONFLICT, "PROJECT_REQUIRED", "工作流版本必须归属于项目才能运行");
        projects.project(ownerId, projectId);
        var key = idempotencyKey == null || idempotencyKey.isBlank() ? text(body.get("idempotencyKey")) : idempotencyKey.trim();
        if (key.length() > 200) throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY", "幂等键长度不能超过 200");
        if (!key.isBlank()) {
            var existing = jdbc.queryForList("""
                    SELECT r.id,r.workflow_id,r.version_id,r.status,r.started_at,r.finished_at,r.trigger_type,r.idempotency_key,
                           r.updated_at,w.project_id FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id
                    WHERE r.owner_id=? AND r.idempotency_key=?
                    """, ownerId, key);
            if (!existing.isEmpty()) {
                if (!versionId.equals(text(existing.get(0).get("version_id")))) {
                    throw new V2ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED",
                            "幂等键已经用于其他工作流版本", Map.of("idempotencyKey", key,
                                    "existingVersionId", existing.get(0).get("version_id")));
                }
                var result = new LinkedHashMap<String, Object>();
                result.put("run", runProjection(existing.get(0)));
                result.put("reused", true);
                return result;
            }
        }
        var spec = sanitizeMap(parseMap(version.get("spec_json")));
        var sourceNodes = array(spec.get("nodes")).stream().map(this::node).filter(node -> "source".equals(text(node.get("type")))).toList();
        if (sourceNodes.isEmpty()) throw new V2ApiException(HttpStatus.CONFLICT, "SOURCE_NODE_REQUIRED", "工作流版本没有来源节点");
        var sourceSnapshot = parseList(version.get("source_snapshot_json"));
        var timestamp = now();
        var triggerType = text(body.get("triggerType"));
        if (triggerType.isBlank()) triggerType = "manual";
        if (!Set.of("manual", "schedule", "webhook", "resume", "retry").contains(triggerType)) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_TRIGGER_TYPE", "触发方式无效");
        }
        final String finalTriggerType = triggerType;
        final String finalKey = key.isBlank() ? null : key;
        try {
            var created = transactions.execute(status -> {
                var jobRows = new ArrayList<Map<String, Object>>();
                for (var node : sourceNodes) {
                    var config = executionConfig(node, sourceSnapshot);
                    var platform = text(config.get("platform"));
                    var sourceKind = text(config.get("kind"));
                    if (platform.isBlank() && Set.of("rss", "rest", "web").contains(sourceKind)) platform = sourceKind;
                    if (platform.isBlank()) throw new V2ApiException(HttpStatus.CONFLICT, "SOURCE_PLATFORM_REQUIRED", "来源节点缺少可执行 platform");
                    var input = new LinkedHashMap<String, Object>();
                    input.put("platform", platform);
                    input.put("keyword", text(config.get("keyword")).isBlank() ? projectId : text(config.get("keyword")));
                    input.put("limit", Math.max(1, Math.min(1000, integer(config.get("limit"), 100))));
                    input.put("includeComments", bool(config.get("includeComments"), true));
                    var options = new LinkedHashMap<String, Object>();
                    options.put("projectId", projectId);
                    options.put("workflowVersionId", versionId);
                    options.put("workflowSpec", spec);
                    options.put("workflowSourceNodeId", text(node.get("id")));
                    options.put("sourceSnapshot", sourceSnapshot);
                    // Keep the legacy executor contract usable while preserving the
                    // v2 guarantee that the execution config contains no secrets.
                    options.put("config", config);
                    if (!text(config.get("url")).isBlank()) options.put("url", config.get("url"));
                    if (!text(config.get("cursor")).isBlank()) options.put("cursor", config.get("cursor"));
                    if (!text(config.get("sourceId")).isBlank()) options.put("sourceId", text(config.get("sourceId")));
                    jobRows.add(jobs.insert(ownerId, input, options));
                }
                var runId = id();
                var trigger = new LinkedHashMap<String, Object>();
                trigger.put("type", finalTriggerType);
                trigger.put("requestedAt", timestamp);
                if (body.containsKey("metadata")) trigger.put("metadata", body.get("metadata"));
                jdbc.update("""
                        INSERT INTO workflow_runs(id,workflow_id,version_id,owner_id,job_id,status,started_at,trigger_json,
                                                  trigger_type,idempotency_key,readiness_json,updated_at)
                        VALUES(?,?,?,?,?,'queued',?,?,?,?,?,?)
                        """, runId, version.get("workflow_id"), versionId, ownerId, jobRows.get(0).get("id"), timestamp,
                        json(mapper, trigger), finalTriggerType, finalKey, "{}", timestamp);
                for (var index = 0; index < jobRows.size(); index++) {
                    var nodeId = text(sourceNodes.get(index).get("id"));
                    var jobId = text(jobRows.get(index).get("id"));
                    jdbc.update("UPDATE jobs SET workflow_run_id=? WHERE id=? AND owner_id=?", runId, jobId, ownerId);
                    jdbc.update("""
                            INSERT INTO workflow_run_jobs(id,run_id,job_id,source_node_id,status,result_json,created_at,updated_at)
                            VALUES(?,?,?,?,'queued',NULL,?,?)
                            """, id(), runId, jobId, nodeId, timestamp, timestamp);
                }
                for (var raw : array(spec.get("nodes"))) {
                    var node = object(raw);
                    var config = "source".equals(text(node.get("type"))) ? object(node.get("config")) : Map.of();
                    jdbc.update("""
                            INSERT INTO workflow_checkpoints(id,run_id,node_id,status,input_json,updated_at)
                            VALUES(?,?,?,'pending',?,?)
                            """, id(), runId, node.get("id"), json(mapper, config), timestamp);
                }
                var eventPayload = new LinkedHashMap<String, Object>();
                eventPayload.put("jobIds", jobRows.stream().map(job -> job.get("id")).toList());
                eventPayload.put("workflowVersionId", versionId);
                jdbc.update("""
                        INSERT INTO workflow_events(id,run_id,node_id,type,message,payload_json,created_at)
                        VALUES(?,?,?,'queued',?,?,?)
                        """, id(), runId, "runtime", "研究运行已进入执行队列", json(mapper, eventPayload), timestamp);
                return runId;
            });
            var result = new LinkedHashMap<String, Object>();
            result.put("run", detailProjection(ownerId, text(created)).get("run"));
            result.put("reused", false);
            return result;
        } catch (V2ApiException error) {
            throw error;
        } catch (ApiException error) {
            throw new V2ApiException(error.status(), "RUN_REJECTED", error.getMessage());
        }
    }

    public Map<String, Object> list(String projectId, String requestedStatus, int requestedLimit, String cursor) {
        projects.project(user.ownerId(), projectId);
        var status = requestedStatus == null ? "" : requestedStatus.trim();
        if (!status.isBlank() && !Set.of("queued", "running", "waiting_review", "blocked", "succeeded", "failed", "cancelled").contains(status)) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_RUN_STATUS", "运行状态无效");
        }
        var limit = Math.max(1, Math.min(100, requestedLimit));
        var offset = V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT r.*,w.project_id,w.name AS workflow_name,v.version,v.spec_hash
                FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id JOIN workflow_versions v ON v.id=r.version_id
                WHERE r.owner_id=? AND w.project_id=?
                  AND (?='' OR (?='succeeded' AND r.status IN ('succeeded','completed','finalizing'))
                       OR (?='waiting_review' AND r.status='awaiting_confirmation') OR r.status=?)
                ORDER BY r.started_at DESC,r.id DESC LIMIT ? OFFSET ?
                """, user.ownerId(), projectId, status, status, status, status, limit + 1, offset);
        var hasMore = rows.size() > limit;
        var result = new LinkedHashMap<String, Object>();
        result.put("projectId", projectId);
        result.put("runs", rows.stream().limit(limit).map(this::runProjection).toList());
        result.put("limit", limit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + limit) : null);
        return result;
    }

    public Map<String, Object> detail(String runId) {
        return detailProjection(user.ownerId(), runId);
    }

    public Map<String, Object> events(String runId, int requestedLimit, String cursor) {
        var run = requireRun(user.ownerId(), runId);
        var limit = Math.max(1, Math.min(500, requestedLimit));
        var offset = V2Cursor.offset(cursor);
        var values = new ArrayList<Map<String, Object>>();
        for (var row : jdbc.queryForList("SELECT * FROM workflow_events WHERE run_id=?", runId)) values.add(workflowEvent(row));
        for (var row : jdbc.queryForList("""
                SELECT e.*,j.source_node_id FROM job_events e JOIN workflow_run_jobs j ON j.job_id=e.job_id WHERE j.run_id=?
                """, runId)) values.add(jobEvent(row));
        values.sort(Comparator.comparing((Map<String, Object> row) -> text(row.get("createdAt"))).thenComparing(row -> text(row.get("id"))));
        var end = Math.min(values.size(), offset + limit);
        var page = offset > values.size() ? List.<Map<String, Object>>of() : values.subList(offset, end);
        var result = new LinkedHashMap<String, Object>();
        result.put("runId", run.get("id"));
        result.put("events", page);
        result.put("limit", limit);
        result.put("nextCursor", end < values.size() ? V2Cursor.next(end) : null);
        return result;
    }

    public Map<String, Object> action(String runId, String action, Map<String, Object> body) {
        var ownerId = user.ownerId();
        requireRun(ownerId, runId);
        var normalized = action == null ? "" : action.trim().toLowerCase();
        if (!Set.of("cancel", "retry", "resume").contains(normalized)) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_RUN_ACTION", "运行操作只允许 cancel、retry 或 resume");
        }
        var changed = transactions.execute(status -> {
            var rows = jdbc.queryForList("SELECT * FROM workflow_runs WHERE id=? AND owner_id=? FOR UPDATE", runId, ownerId);
            if (rows.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "运行记录不存在");
            var current = text(rows.get(0).get("status"));
            var timestamp = now();
            if ("cancel".equals(normalized)) {
                if (!Set.of("queued", "running", "finalizing", "awaiting_confirmation", "blocked").contains(current)) {
                    throw new V2ApiException(HttpStatus.CONFLICT, "RUN_ACTION_NOT_ALLOWED", "当前运行状态不能取消");
                }
                jdbc.update("UPDATE jobs SET status='cancelled',assigned_node_id=NULL,finished_at=?,updated_at=? WHERE workflow_run_id=? AND status IN ('queued','running')", timestamp, timestamp, runId);
                jdbc.update("UPDATE geo_acquisition_executions SET status='cancelled',cancel_requested_at=?,finished_at=?,updated_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE job_id IN (SELECT job_id FROM workflow_run_jobs WHERE run_id=?) AND status NOT IN ('succeeded','failed','cancelled')", timestamp, timestamp, timestamp, runId);
                jdbc.update("UPDATE workflow_runs SET status='cancelled',finished_at=?,updated_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=?", timestamp, timestamp, runId);
            } else {
                if (!Set.of("failed", "cancelled", "blocked", "awaiting_confirmation").contains(current)) {
                    throw new V2ApiException(HttpStatus.CONFLICT, "RUN_ACTION_NOT_ALLOWED", "当前运行状态不能重试或恢复");
                }
                jdbc.update("UPDATE jobs SET status='queued',progress=0,assigned_node_id=NULL,last_error=NULL,finished_at=NULL,updated_at=? WHERE workflow_run_id=? AND status IN ('failed','cancelled','completed')", timestamp, runId);
                jdbc.update("UPDATE workflow_run_jobs SET status='queued',result_json=NULL,updated_at=? WHERE run_id=?", timestamp, runId);
                jdbc.update("UPDATE workflow_checkpoints SET status='pending',output_json=NULL,started_at=NULL,finished_at=NULL,updated_at=? WHERE run_id=?", timestamp, runId);
                jdbc.update("UPDATE workflow_runs SET status='queued',finished_at=NULL,last_error=NULL,trigger_type=?,updated_at=? WHERE id=?", "resume".equals(normalized) ? "resume" : "retry", timestamp, runId);
            }
            jdbc.update("""
                    INSERT INTO workflow_events(id,run_id,node_id,type,message,payload_json,created_at)
                    VALUES(?,?,?,'action',?,?,?)
                    """, id(), runId, "runtime", normalized.equals("cancel") ? "运行已取消" : "运行已重新排队",
                    json(mapper, Map.of("action", normalized)), timestamp);
            return jdbc.queryForMap("SELECT * FROM workflow_runs WHERE id=?", runId);
        });
        return Map.of("run", runProjection(changed));
    }

    private Map<String, Object> detailProjection(String ownerId, String runId) {
        var rows = jdbc.queryForList("""
                SELECT r.*,w.project_id,w.name AS workflow_name,w.description AS workflow_description,
                       v.version,v.spec_json,v.spec_hash,v.source_snapshot_json,v.published_at
                FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id JOIN workflow_versions v ON v.id=r.version_id
                WHERE r.id=? AND r.owner_id=?
                """, runId, ownerId);
        if (rows.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "运行记录不存在");
        var row = rows.get(0);
        var result = new LinkedHashMap<String, Object>();
        result.put("run", runProjection(row));
        var version = new LinkedHashMap<String, Object>();
        version.put("id", row.get("version_id")); version.put("workflowId", row.get("workflow_id"));
        version.put("version", integer(row.get("version"), 0)); version.put("spec", sanitizeMap(parseMap(row.get("spec_json"))));
        version.put("specHash", row.get("spec_hash")); version.put("sourceSnapshot", parseList(row.get("source_snapshot_json")));
        version.put("publishedAt", row.get("published_at"));
        result.put("workflowVersion", version);
        result.put("jobs", jdbc.queryForList("""
                SELECT rj.source_node_id,rj.status AS workflow_status,rj.result_json,rj.created_at AS linked_at,
                       j.id AS job_id,j.platform,j.keyword,j.status,j.progress,j.attempt,j.max_attempts,j.last_error,j.created_at,j.updated_at,j.started_at,j.finished_at
                FROM workflow_run_jobs rj JOIN jobs j ON j.id=rj.job_id WHERE rj.run_id=? ORDER BY rj.created_at
                """, runId));
        result.put("checkpoints", jdbc.queryForList("SELECT * FROM workflow_checkpoints WHERE run_id=? ORDER BY COALESCE(started_at,updated_at),node_id", runId));
        result.put("events", events(runId, 200, "").get("events"));
        return result;
    }

    private Map<String, Object> requireRun(String ownerId, String runId) {
        var rows = jdbc.queryForList("SELECT r.id,w.project_id,r.status FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id WHERE r.id=? AND r.owner_id=?", runId, ownerId);
        if (rows.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "RUN_NOT_FOUND", "运行记录不存在");
        return rows.get(0);
    }

    private Map<String, Object> runProjection(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id")); result.put("projectId", row.get("project_id"));
        result.put("workflowId", row.get("workflow_id")); result.put("workflowVersionId", row.get("version_id"));
        result.put("workflowName", row.get("workflow_name")); result.put("version", row.get("version"));
        result.put("status", normalizeStatus(text(row.get("status")))); result.put("triggerType", row.get("trigger_type"));
        result.put("trigger", parseMap(row.get("trigger_json"))); result.put("idempotencyKey", row.get("idempotency_key"));
        result.put("startedAt", row.get("started_at")); result.put("finishedAt", row.get("finished_at"));
        result.put("lastError", row.get("last_error")); result.put("updatedAt", row.get("updated_at"));
        return result;
    }

    private Map<String, Object> workflowEvent(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id")); result.put("runId", row.get("run_id")); result.put("nodeId", row.get("node_id"));
        result.put("type", row.get("type")); result.put("message", row.get("message"));
        result.put("payload", parseMap(row.get("payload_json"))); result.put("createdAt", row.get("created_at"));
        result.put("source", "workflow"); return result;
    }

    private Map<String, Object> jobEvent(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id")); result.put("runId", row.get("run_id")); result.put("jobId", row.get("job_id"));
        result.put("nodeId", row.get("source_node_id")); result.put("type", row.get("type"));
        result.put("message", row.get("message")); result.put("payload", Map.of()); result.put("createdAt", row.get("created_at"));
        result.put("source", "job"); return result;
    }

    private Map<String, Object> executionConfig(Map<String, Object> node, List<Map<String, Object>> snapshots) {
        var config = new LinkedHashMap<String, Object>();
        var sourceId = text(object(node.get("config")).get("sourceId"));
        for (var snapshot : snapshots) if (sourceId.equals(text(snapshot.get("id")))) {
            config.putAll(object(snapshot.get("config")));
            config.put("kind", snapshot.get("kind"));
        }
        config.putAll(object(node.get("config")));
        return sanitizeMap(config);
    }

    private Map<String, Object> sanitizeMap(Map<String, Object> input) {
        var result = new LinkedHashMap<String, Object>();
        for (var entry : input.entrySet()) {
            var key = entry.getKey();
            if (key == null || SECRET_KEY.matcher(key).find()) continue;
            var value = entry.getValue();
            if (value instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked") var nested = (Map<String, Object>) map;
                result.put(key, sanitizeMap(nested));
            } else if (value instanceof List<?> list) result.put(key, list.stream().map(this::sanitizeValue).toList());
            else result.put(key, value);
        }
        return result;
    }

    private Object sanitizeValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked") var nested = (Map<String, Object>) map;
            return sanitizeMap(nested);
        }
        if (value instanceof List<?> list) return list.stream().map(this::sanitizeValue).toList();
        return value;
    }

    private Map<String, Object> node(Object raw) { return object(raw); }

    private Map<String, Object> parseMap(Object raw) {
        try { return mapper.readValue(text(raw), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception ignored) { return Map.of(); }
    }

    private List<Map<String, Object>> parseList(Object raw) {
        try { return mapper.readValue(text(raw), new TypeReference<List<Map<String, Object>>>() {}); }
        catch (Exception ignored) { return List.of(); }
    }

    private static String normalizeStatus(String value) {
        return switch (value) {
            case "completed", "finalizing" -> "succeeded";
            case "awaiting_confirmation" -> "waiting_review";
            default -> value.isBlank() ? "unknown" : value;
        };
    }
}
