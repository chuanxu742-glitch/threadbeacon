package com.threadbeacon.control.capability;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.workspace.V2ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

/** Derives project readiness from current dependencies; no mutable ready flag is stored. */
@Service
public class ProjectReadinessService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ProjectReadinessService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Map<String, Object> project(String ownerId, String projectId) {
        var project = jdbc.queryForList("SELECT id,name,status FROM projects WHERE id=? AND owner_id=?", projectId, ownerId);
        if (project.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", "项目不存在");
        var checkedAt = now();
        var items = new ArrayList<Map<String, Object>>();
        var sources = jdbc.queryForList("""
                SELECT id,name,kind,status,config_json,health_json,last_probed_at,connection_id,revision
                FROM project_sources WHERE project_id=? AND owner_id=? AND archived_at IS NULL
                ORDER BY created_at
                """, projectId, ownerId);
        if (sources.isEmpty()) {
            items.add(item("PROJECT_SOURCE_REQUIRED", "missing_resource", "项目还没有配置数据源",
                    Map.of("type", "project", "id", projectId), "/projects/" + projectId + "/settings"));
        }
        var activeSources = 0;
        for (var source : sources) {
            var sourceStatus = text(source.get("status"));
            if ("active".equals(sourceStatus) || "ready".equals(sourceStatus) || "verified".equals(sourceStatus)) activeSources++;
            if (sourceCapability(source).isBlank()) {
                items.add(item("SOURCE_CAPABILITY_REQUIRED", "missing_resource", "数据源没有声明可执行能力",
                        Map.of("type", "project_source", "id", source.get("id")), "/projects/" + projectId + "/settings"));
            }
            if ("error".equals(sourceStatus) || "degraded".equals(sourceStatus)) {
                items.add(item("SOURCE_DEGRADED", "degraded", "数据源最近探测失败",
                        Map.of("type", "project_source", "id", source.get("id")), "/projects/" + projectId + "/settings"));
            } else if (!Set.of("active", "ready", "verified").contains(sourceStatus)) {
                items.add(item("SOURCE_PROBE_REQUIRED", "missing_resource", "数据源需要完成一次探测",
                        Map.of("type", "project_source", "id", source.get("id")), "/projects/" + projectId + "/settings"));
            }
        }

        var workflows = jdbc.queryForList("""
                SELECT id,name,status,published_version,last_validation_json
                FROM workflows WHERE project_id=? AND owner_id=? ORDER BY updated_at DESC
                """, projectId, ownerId);
        if (workflows.isEmpty()) {
            items.add(item("PROJECT_WORKFLOW_REQUIRED", "missing_resource", "项目还没有研究流程",
                    Map.of("type", "project", "id", projectId), "/projects/" + projectId + "/orchestration"));
        } else {
            var published = false;
            for (var workflow : workflows) {
                if (integer(workflow.get("published_version"), 0) > 0 && "published".equals(text(workflow.get("status")))) published = true;
                if ("blocked".equals(text(workflow.get("status")))) {
                    items.add(item("WORKFLOW_BLOCKED", "blocked_by_policy", "研究流程校验未通过",
                            Map.of("type", "workflow", "id", workflow.get("id")), "/projects/" + projectId + "/orchestration"));
                }
            }
            if (!published) {
                items.add(item("PUBLISHED_WORKFLOW_REQUIRED", "missing_resource", "项目需要一个已发布的研究流程",
                        Map.of("type", "project", "id", projectId), "/projects/" + projectId + "/orchestration"));
            }
        }

        if (!sources.isEmpty() && !workflows.isEmpty()) {
            var workers = jdbc.queryForList("""
                    SELECT id,capabilities_json,status,last_seen_at FROM nodes
                    WHERE status='online' AND last_seen_at>=?
                    """, Instant.now().minus(60, ChronoUnit.SECONDS).toString());
            if (workers.isEmpty()) {
                items.add(item("EXECUTION_RESOURCE_REQUIRED", "missing_resource", "没有在线执行资源",
                        Map.of("type", "project", "id", projectId), "/setup"));
            } else {
                var capabilities = new java.util.HashSet<String>();
                for (var worker : workers) capabilities.addAll(parseStrings(worker.get("capabilities_json")));
                for (var source : sources) {
                    var required = sourceCapability(source);
                    if (!required.isBlank() && !capabilities.contains(required) && !capabilities.contains("*")) {
                        items.add(item("SOURCE_CAPABILITY_MISSING", "missing_resource", "没有匹配数据源能力的在线执行资源",
                                Map.of("type", "project_source", "id", source.get("id"), "capability", required), "/setup"));
                    }
                }
            }
        }

        var result = new LinkedHashMap<String, Object>();
        result.put("status", overall(items));
        result.put("ready", items.isEmpty());
        result.put("projectId", projectId);
        result.put("lastCheckedAt", checkedAt);
        result.put("items", items);
        result.put("evidence", Map.of("sourceCount", sources.size(), "activeSourceCount", activeSources,
                "workflowCount", workflows.size(), "checkedAt", checkedAt));
        return result;
    }

    private Map<String, Object> item(String code, String status, String message, Map<String, Object> affected,
                                      String remediationRoute) {
        return Map.of("code", code, "status", status, "message", message, "affectedObject", affected,
                "remediationRoute", remediationRoute, "lastCheckedAt", now(), "evidence", Map.of());
    }

    private String overall(List<Map<String, Object>> items) {
        if (items.isEmpty()) return "ready";
        if (items.stream().anyMatch(value -> "blocked_by_policy".equals(text(value.get("status"))))) return "blocked_by_policy";
        if (items.stream().anyMatch(value -> "needs_approval".equals(text(value.get("status"))))) return "needs_approval";
        if (items.stream().anyMatch(value -> "missing_resource".equals(text(value.get("status"))))) return "missing_resource";
        if (items.stream().anyMatch(value -> "degraded".equals(text(value.get("status"))))) return "degraded";
        return "unknown";
    }

    private String sourceCapability(Map<String, Object> source) {
        var kind = text(source.get("kind"));
        if (Set.of("rss", "rest", "web").contains(kind)) return kind;
        var config = parseMap(source.get("config_json"));
        var platform = text(config.get("platform"));
        if ("opencli".equals(kind) && !platform.startsWith("opencli:") && !platform.isBlank()) return "opencli:" + platform;
        return platform;
    }

    private List<String> parseStrings(Object raw) {
        try { return mapper.readValue(text(raw), new TypeReference<List<String>>() {}); }
        catch (Exception ignored) { return List.of(); }
    }

    private Map<String, Object> parseMap(Object raw) {
        try { return mapper.readValue(text(raw), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception ignored) { return Map.of(); }
    }
}
