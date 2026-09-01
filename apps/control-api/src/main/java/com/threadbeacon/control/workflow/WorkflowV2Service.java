package com.threadbeacon.control.workflow;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.project.ProjectV2Service;
import com.threadbeacon.control.workspace.V2ApiException;
import com.threadbeacon.control.workspace.V2Cursor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static com.threadbeacon.control.common.Values.array;
import static com.threadbeacon.control.common.Values.hash;
import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

@Service
public class WorkflowV2Service {
    private static final Pattern SECRET_KEY = Pattern.compile("(?:^|[-_])(password|passwd|secret|token|api[-_]?key|authorization|cookie|credential)(?:$|[-_])", Pattern.CASE_INSENSITIVE);
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final CurrentUser user;
    private final ProjectV2Service projects;

    public WorkflowV2Service(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper mapper,
                             CurrentUser user, ProjectV2Service projects) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper;
        this.user = user;
        this.projects = projects;
    }

    public Map<String, Object> list(String projectId, int requestedLimit, String cursor) {
        projects.project(user.ownerId(), projectId);
        var limit = Math.max(1, Math.min(100, requestedLimit));
        var offset = V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT id,project_id,name,description,revision,published_version,status,last_validation_json,created_at,updated_at
                FROM workflows WHERE owner_id=? AND project_id=? ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?
                """, user.ownerId(), projectId, limit + 1, offset);
        var hasMore = rows.size() > limit;
        var workflows = rows.stream().limit(limit).map(this::projection).toList();
        var result = new LinkedHashMap<String, Object>();
        result.put("projectId", projectId);
        result.put("workflows", workflows);
        result.put("limit", limit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + limit) : null);
        return result;
    }

    public Map<String, Object> create(String projectId, Map<String, Object> body) {
        var project = projects.project(user.ownerId(), projectId);
        if ("archived".equals(text(project.get("status")))) {
            throw new V2ApiException(HttpStatus.CONFLICT, "PROJECT_ARCHIVED", "已归档项目不能新增工作流");
        }
        var name = text(body.get("name"));
        if (name.isBlank() || name.length() > 100) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_WORKFLOW_NAME", "工作流名称长度必须是 1-100 个字符");
        }
        var rawSpec = body.get("spec");
        if (!(rawSpec instanceof Map<?, ?>)) rawSpec = body.get("draft");
        var spec = (rawSpec instanceof Map<?, ?> || rawSpec instanceof String)
                ? WorkflowV2Policy.normalize(sanitizeMap(toMap(rawSpec)))
                : defaultSpec(projectId, text(project.get("name")));
        var workflowId = id();
        var timestamp = now();
        transactions.executeWithoutResult(ignored -> {
            jdbc.update("""
                    INSERT INTO workflows(id,owner_id,project_id,name,description,draft_json,revision,published_version,status,
                                          last_validation_json,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,1,0,'draft','{}',?,?)
                    """, workflowId, user.ownerId(), projectId, name, text(body.get("description")),
                    json(mapper, spec), timestamp, timestamp);
            jdbc.update("""
                    UPDATE projects SET primary_workflow_id=?,updated_at=?
                    WHERE id=? AND owner_id=? AND primary_workflow_id IS NULL
                    """, workflowId, timestamp, projectId, user.ownerId());
            audit("workflow.create", workflowId, Map.of("projectId", projectId));
        });
        return Map.of("workflow", projection(workflow(user.ownerId(), workflowId)));
    }

    public Map<String, Object> draft(String workflowId) {
        var row = workflow(user.ownerId(), workflowId);
        var result = new LinkedHashMap<String, Object>();
        result.put("workflow", projection(row));
        result.put("draft", parseMap(row.get("draft_json")));
        result.put("revision", integer(row.get("revision"), 1));
        result.put("status", text(row.get("status")).isBlank() ? "draft" : row.get("status"));
        result.put("lastValidation", parseMap(row.get("last_validation_json")));
        return result;
    }

    public Map<String, Object> updateDraft(String workflowId, Map<String, Object> body) {
        var ownerId = user.ownerId();
        var current = workflow(ownerId, workflowId);
        if (!body.containsKey("revision")) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "REVISION_REQUIRED", "更新草稿必须携带 revision");
        }
        var expected = integer(body.get("revision"), -1);
        var currentRevision = integer(current.get("revision"), 1);
        if (expected != currentRevision) {
            throw new V2ApiException(HttpStatus.CONFLICT, "REVISION_CONFLICT", "草稿版本冲突，请刷新后重试",
                    Map.of("resource", "workflow_draft", "id", workflowId,
                            "expectedRevision", expected, "currentRevision", currentRevision));
        }
        var raw = body.get("spec");
        if (!(raw instanceof Map<?, ?>)) raw = body.get("draft");
        if (!(raw instanceof Map<?, ?>)) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "DRAFT_REQUIRED", "请求必须包含 spec 或 draft 对象");
        }
        var spec = WorkflowV2Policy.normalize(sanitizeMap(toMap(raw)));
        var changed = jdbc.update("""
                UPDATE workflows SET draft_json=?,revision=revision+1,status='draft',last_validation_json='{}',updated_at=?
                WHERE id=? AND owner_id=? AND revision=?
                """, json(mapper, spec), now(), workflowId, ownerId, expected);
        if (changed != 1) {
            throw new V2ApiException(HttpStatus.CONFLICT, "REVISION_CONFLICT", "草稿版本冲突，请刷新后重试");
        }
        audit("workflow.draft.update", workflowId, Map.of("revision", expected + 1));
        return draft(workflowId);
    }

    public Map<String, Object> validate(String workflowId) {
        return validate(workflowId, Map.of());
    }

    public Map<String, Object> validate(String workflowId, Map<String, Object> body) {
        var ownerId = user.ownerId();
        var row = workflow(ownerId, workflowId);
        if (body != null && body.containsKey("revision")) {
            var expected = integer(body.get("revision"), -1);
            var current = integer(row.get("revision"), 1);
            if (expected != current) {
                throw new V2ApiException(HttpStatus.CONFLICT, "REVISION_CONFLICT", "草稿版本冲突，请刷新后重试",
                        Map.of("resource", "workflow_draft", "id", workflowId,
                                "expectedRevision", expected, "currentRevision", current));
            }
        }
        var result = validateAndPersist(ownerId, row);
        return validationResponse(workflow(ownerId, workflowId), result);
    }

    public Map<String, Object> publish(String workflowId, Map<String, Object> body) {
        var ownerId = user.ownerId();
        var expected = body != null && body.containsKey("revision") ? integer(body.get("revision"), -1) : -1;
        var outcome = transactions.execute(status -> {
            var rows = jdbc.queryForList("SELECT * FROM workflows WHERE id=? AND owner_id=? FOR UPDATE", workflowId, ownerId);
            if (rows.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "WORKFLOW_NOT_FOUND", "工作流不存在");
            var row = rows.get(0);
            var revision = integer(row.get("revision"), 1);
            if (expected >= 0 && expected != revision) {
                throw new V2ApiException(HttpStatus.CONFLICT, "REVISION_CONFLICT", "草稿版本冲突，请刷新后重试",
                        Map.of("resource", "workflow_draft", "id", workflowId, "expectedRevision", expected, "currentRevision", revision));
            }
            var validation = validateRow(ownerId, row);
            var validationJson = json(mapper, withRevision(validation, revision));
            if (!Boolean.TRUE.equals(validation.get("valid"))) {
                jdbc.update("UPDATE workflows SET status='blocked',last_validation_json=?,updated_at=? WHERE id=?", validationJson, now(), workflowId);
                var blocked = new LinkedHashMap<String, Object>();
                blocked.put("blocked", true);
                blocked.put("validation", validation);
                return blocked;
            }
            var nextVersion = integer(row.get("published_version"), 0) + 1;
            var versionId = id();
            var timestamp = now();
            var specText = json(mapper, sanitizeMap(parseMap(row.get("draft_json"))));
            var sourceSnapshot = sourceSnapshot(ownerId, text(row.get("project_id")), parseMap(specText));
            jdbc.update("""
                    INSERT INTO workflow_versions(id,workflow_id,owner_id,version,spec_json,spec_hash,source_snapshot_json,published_at,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?)
                    """, versionId, workflowId, ownerId, nextVersion, specText, hash(specText),
                    json(mapper, sourceSnapshot), timestamp, timestamp);
            jdbc.update("UPDATE workflows SET published_version=?,status='published',last_validation_json=?,updated_at=? WHERE id=?",
                    nextVersion, validationJson, timestamp, workflowId);
            jdbc.update("UPDATE projects SET primary_workflow_id=COALESCE(primary_workflow_id,?),updated_at=? WHERE id=? AND owner_id=?",
                    workflowId, timestamp, row.get("project_id"), ownerId);
            audit("workflow.publish", workflowId, Map.of("version", nextVersion, "versionId", versionId));
            var published = new LinkedHashMap<String, Object>();
            published.put("blocked", false);
            published.put("version", version(jdbc.queryForMap("SELECT * FROM workflow_versions WHERE id=?", versionId)));
            published.put("validation", validation);
            return published;
        });
        if (Boolean.TRUE.equals(outcome.get("blocked"))) {
            throw new V2ApiException(HttpStatus.CONFLICT, "WORKFLOW_BLOCKED", "工作流校验未通过，不能发布",
                    Map.of("validation", outcome.get("validation")));
        }
        return outcome;
    }

    public Map<String, Object> versions(String workflowId, int requestedLimit, String cursor) {
        var workflow = workflow(user.ownerId(), workflowId);
        var limit = Math.max(1, Math.min(100, requestedLimit));
        var offset = V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT * FROM workflow_versions WHERE workflow_id=? AND owner_id=? ORDER BY version DESC LIMIT ? OFFSET ?
                """, workflowId, user.ownerId(), limit + 1, offset);
        var hasMore = rows.size() > limit;
        var result = new LinkedHashMap<String, Object>();
        result.put("workflowId", workflow.get("id"));
        result.put("versions", rows.stream().limit(limit).map(this::version).toList());
        result.put("limit", limit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + limit) : null);
        return result;
    }

    public Map<String, Object> workflow(String ownerId, String workflowId) {
        var rows = jdbc.queryForList("""
                SELECT w.*,p.name AS project_name FROM workflows w LEFT JOIN projects p ON p.id=w.project_id
                WHERE w.id=? AND w.owner_id=?
                """, workflowId, ownerId);
        if (rows.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "WORKFLOW_NOT_FOUND", "工作流不存在");
        return rows.get(0);
    }

    public Map<String, Object> versionById(String versionId) {
        var rows = jdbc.queryForList("""
                SELECT v.*,w.project_id,w.name AS workflow_name FROM workflow_versions v
                JOIN workflows w ON w.id=v.workflow_id WHERE v.id=? AND v.owner_id=?
                """, versionId, user.ownerId());
        if (rows.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "WORKFLOW_VERSION_NOT_FOUND", "工作流版本不存在");
        return rows.get(0);
    }

    private Map<String, Object> validateAndPersist(String ownerId, Map<String, Object> row) {
        var validation = validateRow(ownerId, row);
        var withRevision = withRevision(validation, integer(row.get("revision"), 1));
        jdbc.update("UPDATE workflows SET status=?,last_validation_json=?,updated_at=? WHERE id=? AND owner_id=?",
                Boolean.TRUE.equals(validation.get("valid")) ? "valid" : "blocked", json(mapper, withRevision), now(), row.get("id"), ownerId);
        audit("workflow.validate", text(row.get("id")), Map.of("valid", validation.get("valid")));
        return withRevision;
    }

    private Map<String, Object> validateRow(String ownerId, Map<String, Object> row) {
        return WorkflowV2Policy.validate(parseMap(row.get("draft_json")), ownerId, text(row.get("project_id")), jdbc, mapper);
    }

    private Map<String, Object> validationResponse(Map<String, Object> row, Map<String, Object> validation) {
        var result = new LinkedHashMap<String, Object>();
        result.put("workflow", projection(row));
        result.put("draft", parseMap(row.get("draft_json")));
        result.put("revision", integer(row.get("revision"), 1));
        result.put("validation", validation);
        return result;
    }

    private Map<String, Object> withRevision(Map<String, Object> validation, int revision) {
        var result = new LinkedHashMap<String, Object>(validation);
        result.put("checkedRevision", revision);
        return result;
    }

    private Map<String, Object> projection(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id"));
        result.put("projectId", row.get("project_id"));
        result.put("name", row.get("name"));
        result.put("description", row.get("description"));
        result.put("revision", integer(row.get("revision"), 1));
        result.put("publishedVersion", integer(row.get("published_version"), 0));
        result.put("status", text(row.get("status")).isBlank() ? "draft" : row.get("status"));
        result.put("lastValidation", parseMap(row.get("last_validation_json")));
        result.put("createdAt", row.get("created_at"));
        result.put("updatedAt", row.get("updated_at"));
        return result;
    }

    private Map<String, Object> version(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id"));
        result.put("workflowId", row.get("workflow_id"));
        result.put("version", integer(row.get("version"), 0));
        result.put("spec", parseMap(row.get("spec_json")));
        result.put("specHash", text(row.get("spec_hash")));
        result.put("sourceSnapshot", parseMap(row.get("source_snapshot_json")));
        result.put("publishedAt", row.get("published_at"));
        result.put("createdAt", row.get("created_at"));
        return result;
    }

    private List<Map<String, Object>> sourceSnapshot(String ownerId, String projectId, Map<String, Object> spec) {
        var ids = array(spec.get("nodes")).stream().map(WorkflowV2Policy::node).map(node -> text(object(node.get("config")).get("sourceId"))).filter(value -> !value.isBlank()).distinct().toList();
        var result = new ArrayList<Map<String, Object>>();
        for (var sourceId : ids) {
            var rows = jdbc.queryForList("""
                    SELECT id,project_id,name,kind,config_json,connection_id,revision,status
                    FROM project_sources WHERE id=? AND project_id=? AND owner_id=? AND archived_at IS NULL
                    """, sourceId, projectId, ownerId);
            if (rows.isEmpty()) continue;
            var source = rows.get(0);
            var snapshot = new LinkedHashMap<String, Object>();
            snapshot.put("id", source.get("id")); snapshot.put("projectId", source.get("project_id"));
            snapshot.put("name", source.get("name")); snapshot.put("kind", source.get("kind"));
            snapshot.put("config", sanitizeMap(parseMap(source.get("config_json"))));
            snapshot.put("connectionId", source.get("connection_id")); snapshot.put("revision", source.get("revision"));
            snapshot.put("statusAtPublish", source.get("status"));
            result.add(snapshot);
        }
        return result;
    }

    private void audit(String action, String resourceId, Map<String, Object> details) {
        jdbc.update("""
                INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                VALUES(?,?,?,'workflow',?,?,?)
                """, id(), user.ownerId(), action, resourceId, json(mapper, details), now());
    }

    private Map<String, Object> toMap(Object raw) {
        if (raw instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked") var result = (Map<String, Object>) map;
            return new LinkedHashMap<>(result);
        }
        if (raw instanceof String value && !value.isBlank()) {
            try { return mapper.readValue(value, new TypeReference<Map<String, Object>>() {}); }
            catch (Exception ignored) { throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_WORKFLOW_SPEC", "工作流 spec JSON 无效"); }
        }
        return new LinkedHashMap<>();
    }

    private Map<String, Object> defaultSpec(String projectId, String projectName) {
        var config = new LinkedHashMap<String, Object>();
        var sources = jdbc.queryForList("""
                SELECT id,kind,config_json FROM project_sources
                WHERE project_id=? AND owner_id=? AND archived_at IS NULL ORDER BY created_at LIMIT 1
                """, projectId, user.ownerId());
        if (!sources.isEmpty()) {
            var source = sources.get(0);
            config.put("sourceId", source.get("id"));
            config.putAll(sanitizeMap(parseMap(source.get("config_json"))));
            if (text(config.get("platform")).isBlank()) config.put("platform", text(source.get("kind")));
        } else {
            config.put("platform", "rss");
            config.put("keyword", projectName.isBlank() ? "research" : projectName);
        }
        return Map.of("nodes", List.of(Map.of("id", "source-1", "type", "source", "label", "研究来源", "config", config)),
                "edges", List.of());
    }

    private Map<String, Object> parseMap(Object raw) {
        try { return mapper.readValue(text(raw), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception ignored) { return Map.of(); }
    }

    private Map<String, Object> sanitizeMap(Map<String, Object> input) {
        var result = new LinkedHashMap<String, Object>();
        for (var entry : input.entrySet()) {
            var key = entry.getKey();
            if (key == null || SECRET_KEY.matcher(key).find()) continue;
            if (entry.getValue() instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked") var nested = (Map<String, Object>) map;
                result.put(key, sanitizeMap(nested));
            } else if (entry.getValue() instanceof List<?> list) result.put(key, list.stream().map(this::sanitizeValue).toList());
            else result.put(key, entry.getValue());
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
}
