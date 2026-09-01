package com.threadbeacon.control.workspace;

import com.threadbeacon.control.capability.ProjectReadinessService;
import com.threadbeacon.control.common.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

@Service
public class WorkspaceV2Service {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final CurrentUser user;
    private final ProjectReadinessService readiness;

    public WorkspaceV2Service(JdbcTemplate jdbc, TransactionTemplate transactions, CurrentUser user,
                              ProjectReadinessService readiness) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.user = user;
        this.readiness = readiness;
    }

    public Map<String, Object> context() {
        var ownerId = user.ownerId();
        ensureWorkspace(ownerId);
        var workspace = workspace(ownerId);
        var membership = jdbc.queryForList(
                "SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?",
                workspace.get("id"), user.userId());
        var result = new LinkedHashMap<String, Object>();
        result.put("user", Map.of(
                "id", user.userId(),
                "ownerId", ownerId,
                "email", user.email(),
                "displayName", user.displayName()));
        result.put("workspace", Map.of(
                "id", workspace.get("id"),
                "name", workspace.get("name"),
                "role", membership.isEmpty() ? "viewer" : text(membership.get(0).get("role"))));
        result.put("workspaces", workspaces(user.userId()));
        result.put("pulse", pulse(ownerId));
        result.put("recentReports", recentReports(ownerId));
        result.put("apiVersion", "v2");
        return result;
    }

    public Map<String, Object> currentWorkspace() {
        ensureWorkspace(user.ownerId());
        return workspace(user.ownerId());
    }

    private List<Map<String, Object>> workspaces(String userId) {
        return jdbc.queryForList("""
                SELECT w.id,w.name,w.owner_id,m.role,m.created_at
                FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
                WHERE m.user_id=? ORDER BY m.created_at
                """, userId);
    }

    private Map<String, Object> pulse(String ownerId) {
        var projectIds = jdbc.queryForList(
                "SELECT id FROM projects WHERE owner_id=? AND COALESCE(status,'active')<>'archived'", ownerId);
        var readyProjects = 0;
        for (var project : projectIds) {
            if (Boolean.TRUE.equals(readiness.project(ownerId, text(project.get("id"))).get("ready"))) readyProjects++;
        }
        var activeRuns = count("""
                SELECT count(*) FROM workflow_runs
                WHERE owner_id=? AND status IN ('queued','running','finalizing','waiting_review','awaiting_confirmation','blocked')
                """, ownerId);
        var recentReports = count("""
                SELECT (SELECT count(*) FROM report_versions WHERE owner_id=? AND created_at>=?)
                     + (SELECT count(*) FROM reports WHERE owner_id=? AND created_at>=?)
                """, ownerId, Instant.now().minus(30, ChronoUnit.DAYS).toString(),
                ownerId, Instant.now().minus(30, ChronoUnit.DAYS).toString());
        return Map.of(
                "ready", readyProjects + "/" + projectIds.size(),
                "readyProjects", readyProjects,
                "totalProjects", projectIds.size(),
                "activeRuns", activeRuns,
                "recentReports", recentReports);
    }

    private List<Map<String, Object>> recentReports(String ownerId) {
        return jdbc.queryForList("""
                SELECT rv.id,rv.project_id,rv.title,rv.version,rv.published_at AS created_at,'formal' AS kind
                FROM report_versions rv WHERE rv.owner_id=?
                UNION ALL
                SELECT r.id,r.project_id,COALESCE(j.keyword,'研究报告') AS title,0 AS version,r.created_at,'legacy' AS kind
                FROM reports r JOIN jobs j ON j.id=r.job_id WHERE r.owner_id=?
                ORDER BY created_at DESC LIMIT 5
                """, ownerId, ownerId);
    }

    private int count(String sql, Object... args) {
        var value = jdbc.queryForObject(sql, Number.class, args);
        return value == null ? 0 : value.intValue();
    }

    private Map<String, Object> workspace(String ownerId) {
        var rows = jdbc.queryForList("SELECT id,name,owner_id,created_at,updated_at FROM workspaces WHERE owner_id=?", ownerId);
        if (rows.isEmpty()) {
            throw new V2ApiException(org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                    "WORKSPACE_UNAVAILABLE", "当前工作区不可用");
        }
        return rows.get(0);
    }

    private void ensureWorkspace(String ownerId) {
        if (!jdbc.queryForList("SELECT id FROM workspaces WHERE owner_id=?", ownerId).isEmpty()) return;
        transactions.executeWithoutResult(ignored -> {
            var timestamp = now();
            var workspaceId = id();
            jdbc.update("""
                    INSERT INTO workspaces(id,owner_id,name,created_at,updated_at)
                    VALUES(?,?,'个人工作区',?,?) ON CONFLICT(owner_id) DO NOTHING
                    """, workspaceId, ownerId, timestamp, timestamp);
            var actual = workspace(ownerId);
            jdbc.update("""
                    INSERT INTO workspace_members(id,workspace_id,user_id,role,created_at)
                    VALUES(?,?,?,'owner',?) ON CONFLICT(workspace_id,user_id) DO NOTHING
                    """, id(), actual.get("id"), ownerId, timestamp);
        });
        // A PAT may resolve a workspace owner while its principal user id is
        // different.  Keep the owner membership intact and do not grant a
        // second role implicitly.
    }
}
