package com.threadbeacon.control.project;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.capability.ProjectReadinessService;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2ApiException;
import com.threadbeacon.control.workspace.V2Cursor;
import com.threadbeacon.control.workspace.WorkspaceV2Service;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

@Service
public class ProjectV2Service {
    private static final Set<String> TEMPLATES = Set.of("market-watch", "competitor", "content-radar", "blank");
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final CurrentUser user;
    private final WorkspaceV2Service workspaces;
    private final ProjectReadinessService readiness;

    public ProjectV2Service(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper mapper,
                            CurrentUser user, WorkspaceV2Service workspaces, ProjectReadinessService readiness) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper;
        this.user = user;
        this.workspaces = workspaces;
        this.readiness = readiness;
    }

    public Map<String, Object> list(String search, String status, int requestedLimit, String cursor) {
        var ownerId = user.ownerId();
        var limit = Math.max(1, Math.min(100, requestedLimit));
        var offset = V2Cursor.offset(cursor);
        var filter = search == null ? "" : search.trim();
        var requestedStatus = status == null ? "" : status.trim();
        if (!requestedStatus.isBlank() && !Set.of("active", "archived").contains(requestedStatus)) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_PROJECT_STATUS", "项目状态无效");
        }
        var rows = jdbc.queryForList("""
                SELECT p.*, w.name AS workspace_name,
                       (SELECT count(*) FROM project_sources s
                        WHERE s.project_id=p.id AND s.archived_at IS NULL) AS source_count,
                       (SELECT count(*) FROM workflow_runs r
                        WHERE r.workflow_id IN (SELECT id FROM workflows WHERE project_id=p.id)) AS run_count
                FROM projects p JOIN workspaces w ON w.id=p.workspace_id
                WHERE p.owner_id=?
                  AND (?='' OR lower(p.name) LIKE lower('%'||?||'%')
                       OR lower(p.description) LIKE lower('%'||?||'%'))
                  AND (?='' OR (?='archived' AND p.status='archived')
                               OR (?='active' AND COALESCE(p.status,'active')<>'archived'))
                ORDER BY p.updated_at DESC,p.id DESC LIMIT ? OFFSET ?
                """, ownerId, filter, filter, filter, requestedStatus, requestedStatus,
                requestedStatus, limit + 1, offset);
        var hasMore = rows.size() > limit;
        var projects = rows.stream().limit(limit).map(this::projectProjection).toList();
        var result = new LinkedHashMap<String, Object>();
        result.put("projects", projects);
        result.put("limit", limit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + limit) : null);
        return result;
    }

    public Map<String, Object> create(Map<String, Object> body) {
        var ownerId = user.ownerId();
        var name = text(body.get("name"));
        if (name.isBlank() || name.length() > 100) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_PROJECT_NAME", "项目名称长度必须是 1-100 个字符");
        }
        var template = text(body.get("template"));
        if (template.isBlank()) template = "blank";
        if (!TEMPLATES.contains(template)) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_PROJECT_TEMPLATE", "项目模板不受支持",
                    Map.of("allowed", TEMPLATES));
        }
        var workspace = workspaces.currentWorkspace();
        var projectId = id();
        var timestamp = now();
        var description = text(body.get("description"));
        var objectiveValue = text(body.get("objective"));
        if (objectiveValue.isBlank()) objectiveValue = text(body.get("goal"));
        var templateValue = template;
        var objective = objectiveValue;
        var playbook = "competitor".equals(templateValue) ? "competitive-research" : "generic-research";
        var createdProject = transactions.execute(status -> {
            jdbc.update("""
                    INSERT INTO projects(id,owner_id,workspace_id,name,description,template,playbook_key,playbook_version,
                                         status,objective,revision,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,'active',?,1,?,?)
                    """, projectId, ownerId, workspace.get("id"), name, description, templateValue, playbook, "1.0",
                    objective, timestamp, timestamp);
            audit(ownerId, "project.create", projectId, Map.of("template", templateValue));
            return project(ownerId, projectId);
        });
        return Map.of("project", createdProject);
    }

    public Map<String, Object> get(String projectId) {
        return project(user.ownerId(), projectId);
    }

    public Map<String, Object> update(String projectId, Map<String, Object> body) {
        var ownerId = user.ownerId();
        var current = project(ownerId, projectId);
        var nextName = body.containsKey("name") ? text(body.get("name")) : text(current.get("name"));
        var nextDescription = body.containsKey("description") ? text(body.get("description")) : text(current.get("description"));
        var nextObjective = body.containsKey("objective") ? text(body.get("objective")) : text(current.get("objective"));
        if (body.containsKey("goal") && !body.containsKey("objective")) nextObjective = text(body.get("goal"));
        if (nextName.isBlank() || nextName.length() > 100) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_PROJECT_NAME", "项目名称长度必须是 1-100 个字符");
        }
        var action = text(body.get("action"));
        var requestedStatus = text(body.get("status"));
        if ("archive".equals(action)) requestedStatus = "archived";
        if (requestedStatus.isBlank()) requestedStatus = text(current.get("status"));
        if (!Set.of("active", "archived").contains(requestedStatus)) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_PROJECT_STATUS", "项目状态只允许 active 或 archived");
        }
        var expected = body.containsKey("revision") ? integer(body.get("revision"), -1) : integer(current.get("revision"), 1);
        if (expected < 1) throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_REVISION", "revision 必须是正整数");
        var timestamp = now();
        var changed = jdbc.update("""
                UPDATE projects SET name=?,description=?,objective=?,status=?,archived_at=CASE WHEN ?='archived' THEN COALESCE(archived_at,?) ELSE NULL END,
                    revision=revision+1,updated_at=?
                WHERE id=? AND owner_id=? AND revision=?
                """, nextName, nextDescription, nextObjective, requestedStatus, requestedStatus, timestamp,
                timestamp, projectId, ownerId, expected);
        if (changed != 1) {
            throw new V2ApiException(HttpStatus.CONFLICT, "REVISION_CONFLICT", "项目已被其他请求修改，请刷新后重试",
                    Map.of("resource", "project", "id", projectId, "expectedRevision", expected));
        }
        audit(ownerId, "project.update", projectId, Map.of("status", requestedStatus));
        return Map.of("project", project(ownerId, projectId));
    }

    public Map<String, Object> detail(String projectId) {
        var ownerId = user.ownerId();
        var project = project(ownerId, projectId);
        var workflows = jdbc.queryForList("""
                SELECT id,project_id,name,description,revision,published_version,status,created_at,updated_at
                FROM workflows WHERE owner_id=? AND project_id=? ORDER BY updated_at DESC
                """, ownerId, projectId);
        var primaryId = text(project.get("primary_workflow_id"));
        Map<String, Object> primary = null;
        if (!primaryId.isBlank()) {
            var matches = workflows.stream().filter(row -> primaryId.equals(text(row.get("id")))).toList();
            if (!matches.isEmpty()) primary = matches.get(0);
        }
        if (primary == null && !workflows.isEmpty()) primary = workflows.get(0);
        var result = new LinkedHashMap<String, Object>();
        result.put("project", projectProjection(project));
        result.put("primaryWorkflow", primary);
        result.put("workflows", workflows);
        result.put("readiness", readiness.project(ownerId, projectId));
        return result;
    }

    public Map<String, Object> overview(String projectId) {
        var ownerId = user.ownerId();
        var project = project(ownerId, projectId);
        var runCount = count("SELECT count(*) FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id WHERE r.owner_id=? AND w.project_id=?", ownerId, projectId);
        var observationCount = count("SELECT count(*) FROM observations WHERE owner_id=? AND project_id=?", ownerId, projectId);
        var findingCount = count("SELECT count(*) FROM evidence WHERE owner_id=? AND project_id=?", ownerId, projectId);
        var reportCount = count("SELECT count(*) FROM reports WHERE owner_id=? AND project_id=?", ownerId, projectId);
        var latestRuns = jdbc.queryForList("""
                SELECT r.id,r.workflow_id,r.version_id,r.status,r.trigger_type,r.trigger_json,r.started_at,r.finished_at,r.last_error,
                       w.name AS workflow_name,v.version
                FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id JOIN workflow_versions v ON v.id=r.version_id
                WHERE r.owner_id=? AND w.project_id=? ORDER BY r.started_at DESC LIMIT 10
                """, ownerId, projectId).stream().map(row -> runProjection(row)).toList();
        var latestReports = jdbc.queryForList("""
                SELECT id,project_id,workflow_run_id,item_count,pain_point_count,observation_count,method_key,method_version,generated_at,created_at
                FROM reports WHERE owner_id=? AND project_id=? ORDER BY created_at DESC LIMIT 10
                """, ownerId, projectId);
        var result = new LinkedHashMap<String, Object>();
        result.put("project", projectProjection(project));
        result.put("readiness", readiness.project(ownerId, projectId));
        result.put("counts", Map.of("runs", runCount, "observations", observationCount,
                "findings", findingCount, "reports", reportCount));
        result.put("latestRuns", latestRuns);
        result.put("latestReports", latestReports);
        result.put("nextActions", nextActions(projectId, project));
        return result;
    }

    public Map<String, Object> readiness(String projectId) {
        project(user.ownerId(), projectId);
        return readiness.project(user.ownerId(), projectId);
    }

    public Map<String, Object> project(String ownerId, String projectId) {
        var rows = jdbc.queryForList("""
                SELECT p.*,w.name AS workspace_name FROM projects p JOIN workspaces w ON w.id=p.workspace_id
                WHERE p.id=? AND p.owner_id=?
                """, projectId, ownerId);
        if (rows.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", "项目不存在");
        return rows.get(0);
    }

    public boolean owns(String ownerId, String projectId) {
        return !jdbc.queryForList("SELECT id FROM projects WHERE id=? AND owner_id=?", projectId, ownerId).isEmpty();
    }

    private Map<String, Object> projectProjection(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.putAll(row);
        result.putIfAbsent("status", "active");
        result.putIfAbsent("revision", 1);
        result.put("archived", "archived".equals(text(row.get("status"))));
        return result;
    }

    private Map<String, Object> runProjection(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>(row);
        var status = text(row.get("status"));
        result.put("status", normalizeRunStatus(status));
        return result;
    }

    private List<String> nextActions(String projectId, Map<String, Object> project) {
        var actions = new java.util.ArrayList<String>();
        if (count("SELECT count(*) FROM project_sources WHERE project_id=? AND archived_at IS NULL", projectId) == 0) actions.add("connect_source");
        if (count("SELECT count(*) FROM workflows WHERE project_id=? AND status='published'", projectId) == 0) actions.add("create_and_publish_workflow");
        if (actions.isEmpty() && count("SELECT count(*) FROM workflow_runs r JOIN workflows w ON w.id=r.workflow_id WHERE w.project_id=?", projectId) == 0) actions.add("run_workflow");
        return actions;
    }

    private int count(String sql, Object... args) {
        var value = jdbc.queryForObject(sql, Number.class, args);
        return value == null ? 0 : value.intValue();
    }

    private void audit(String ownerId, String action, String resourceId, Map<String, Object> detail) {
        jdbc.update("""
                INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                VALUES(?,?,?,'project',?,?,?)
                """, id(), ownerId, action, resourceId, json(mapper, detail), now());
    }

    private static String normalizeRunStatus(String status) {
        return switch (status) {
            case "completed", "finalizing" -> "succeeded";
            case "awaiting_confirmation" -> "waiting_review";
            default -> status.isBlank() ? "unknown" : status;
        };
    }
}
