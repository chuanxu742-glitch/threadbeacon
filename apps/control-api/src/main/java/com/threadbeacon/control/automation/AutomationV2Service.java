package com.threadbeacon.control.automation;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.text;

/** Read projection for repeatable methods. Runtime protocols remain in their owning modules. */
@Service
public class AutomationV2Service {
    private final JdbcTemplate jdbc;

    public AutomationV2Service(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> list(String ownerId) {
        var schedules = scheduleItems(ownerId);
        var workflows = workflowItems(ownerId);
        var skills = skillItems(ownerId);
        var items = new ArrayList<Map<String, Object>>();
        items.addAll(workflows);
        items.addAll(schedules);
        items.addAll(skills);
        return Map.of(
                "automations", items,
                "workflows", workflows,
                "schedules", schedules,
                "skills", skills,
                "readOnlyProjection", true);
    }

    private List<Map<String, Object>> scheduleItems(String ownerId) {
        return jdbc.queryForList("""
                SELECT id,name,platform,keyword,interval_minutes,cron_expression,timezone,enabled,
                       last_run_at,next_run_at,created_at,updated_at
                FROM schedules WHERE owner_id=? ORDER BY created_at DESC LIMIT 100
                """, ownerId).stream().map(row -> {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("id", row.get("id"));
            result.put("type", "schedule");
            result.put("name", row.get("name"));
            result.put("description", text(row.get("platform")) + " · " + text(row.get("keyword")));
            result.put("status", integer(row.get("enabled"), 0) == 1 ? "active" : "paused");
            var cron = text(row.get("cron_expression"));
            result.put("trigger", cron.isBlank()
                    ? "每 " + integer(row.get("interval_minutes"), 60) + " 分钟"
                    : cron + " · " + text(row.get("timezone")));
            result.put("lastRunAt", row.get("last_run_at"));
            result.put("nextRunAt", row.get("next_run_at"));
            result.put("createdAt", row.get("created_at"));
            result.put("updatedAt", row.get("updated_at"));
            result.put("legacyQuickJob", true);
            return result;
        }).toList();
    }

    private List<Map<String, Object>> workflowItems(String ownerId) {
        return jdbc.queryForList("""
                SELECT w.id,w.project_id,w.name,w.description,w.status,w.published_version,w.updated_at,
                       v.id AS workflow_version_id,v.version,v.published_at
                FROM workflows w
                JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=w.published_version
                WHERE w.owner_id=? AND w.published_version>0
                ORDER BY w.updated_at DESC LIMIT 100
                """, ownerId).stream().map(row -> {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("id", row.get("id"));
            result.put("type", "workflow");
            result.put("projectId", row.get("project_id"));
            result.put("name", row.get("name"));
            result.put("description", row.get("description"));
            result.put("status", row.get("status"));
            result.put("workflowVersionId", row.get("workflow_version_id"));
            result.put("version", row.get("version"));
            result.put("publishedAt", row.get("published_at"));
            result.put("updatedAt", row.get("updated_at"));
            return result;
        }).toList();
    }

    private List<Map<String, Object>> skillItems(String ownerId) {
        return jdbc.queryForList("""
                SELECT id,name,domain,capability,scope,status,current_version,enabled,updated_at
                FROM skills WHERE owner_id=? AND status<>'deprecated'
                ORDER BY updated_at DESC LIMIT 100
                """, ownerId).stream().map(row -> {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("id", row.get("id"));
            result.put("type", "skill");
            result.put("name", row.get("name"));
            result.put("description", row.get("scope"));
            result.put("status", integer(row.get("enabled"), 0) == 1 ? row.get("status") : "disabled");
            result.put("domain", row.get("domain"));
            result.put("capability", row.get("capability"));
            result.put("version", row.get("current_version"));
            result.put("updatedAt", row.get("updated_at"));
            return result;
        }).toList();
    }
}
