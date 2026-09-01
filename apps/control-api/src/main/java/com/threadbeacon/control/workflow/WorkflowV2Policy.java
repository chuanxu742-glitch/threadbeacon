package com.threadbeacon.control.workflow;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.platform.WorkflowSpecPolicy;
import com.threadbeacon.control.workspace.V2ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.array;
import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

/** Draft validation is deterministic and returns issues instead of one opaque error string. */
public final class WorkflowV2Policy {
    private static final Set<String> TYPES = Set.of(
            "source", "normalize", "dedupe", "filter", "gate", "cluster", "llm",
            "agent", "report", "dataset", "deliver");
    private WorkflowV2Policy() {}

    public static Map<String, Object> normalize(Map<String, Object> input) {
        var result = new LinkedHashMap<String, Object>(input == null ? Map.of() : input);
        if (!result.containsKey("nodes")) result.put("nodes", List.of());
        if (!result.containsKey("edges")) result.put("edges", List.of());
        return result;
    }

    public static Map<String, Object> validate(Map<String, Object> spec, String ownerId, String projectId,
                                                JdbcTemplate jdbc, ObjectMapper mapper) {
        var issues = new ArrayList<Map<String, Object>>();
        var normalized = hydrateSourcePlatforms(normalize(spec), ownerId, projectId, jdbc, mapper);
        try {
            WorkflowSpecPolicy.validate(normalized);
        } catch (ApiException error) {
            issues.add(issue("WORKFLOW_STRUCTURE_INVALID", "blocked_by_policy", error.getMessage(), "spec", "workflow", projectId));
        }
        var nodes = array(normalized.get("nodes"));
        var seen = new HashSet<String>();
        for (var raw : nodes) {
            var node = object(raw);
            var nodeId = text(node.get("id"));
            var nodePath = "nodes[" + Math.max(0, nodes.indexOf(raw)) + "]";
            if (!seen.add(nodeId)) continue;
            var type = text(node.get("type"));
            var config = object(node.get("config"));
            if (Boolean.TRUE.equals(config.get("blockedByCompatibility")) ||
                    "blocked".equals(text(config.get("compatibilityStatus")))) {
                issues.add(issue("COMPATIBILITY_BLOCKED", "blocked_by_policy", "节点仍被兼容性审查阻断", nodePath, nodeId, projectId));
            }
            if ("source".equals(type)) {
                var sourceId = text(config.get("sourceId"));
                var platform = text(config.get("platform"));
                if (!sourceId.isBlank()) {
                    var sources = jdbc.queryForList("""
                            SELECT id,kind,config_json,status FROM project_sources
                            WHERE id=? AND project_id=? AND owner_id=? AND archived_at IS NULL
                            """, sourceId, projectId, ownerId);
                    if (sources.isEmpty()) {
                        issues.add(issue("SOURCE_NOT_FOUND", "missing_resource", "来源节点引用的数据源不存在", nodePath, nodeId, projectId));
                    } else {
                        var row = sources.get(0);
                        var sourceConfig = parseMap(row.get("config_json"), mapper);
                        if (platform.isBlank()) platform = text(sourceConfig.get("platform"));
                        if (platform.isBlank() && !Set.of("rss", "rest", "web").contains(text(row.get("kind")))) {
                            issues.add(issue("SOURCE_PLATFORM_REQUIRED", "missing_resource", "来源缺少可执行 platform", nodePath, nodeId, projectId));
                        }
                        var sourceStatus = text(row.get("status"));
                        if (!Set.of("active", "ready", "verified").contains(sourceStatus)) {
                            var status = Set.of("configured", "testing").contains(sourceStatus) ? "missing_resource" : "degraded";
                            var code = Set.of("configured", "testing").contains(sourceStatus) ? "SOURCE_NOT_READY" : "SOURCE_UNAVAILABLE";
                            issues.add(issue(code, status, "来源尚未完成探测或当前不可用", nodePath, nodeId, projectId));
                        }
                    }
                } else if (platform.isBlank()) {
                    issues.add(issue("SOURCE_BINDING_REQUIRED", "missing_resource", "来源节点必须绑定 project source 或 platform", nodePath, nodeId, projectId));
                }
            }
            if ("agent".equals(type)) {
                var skillId = text(config.get("skillId"));
                if (skillId.isBlank()) {
                    issues.add(issue("SKILL_BINDING_REQUIRED", "missing_resource", "Agent 节点必须绑定 Skill", nodePath, nodeId, projectId));
                } else if (jdbc.queryForObject("SELECT count(*) FROM skills WHERE id=? AND owner_id=? AND status='active' AND enabled=1", Integer.class, skillId, ownerId) != 1) {
                    issues.add(issue("SKILL_NOT_READY", "missing_resource", "绑定的 Skill 不存在或未发布", nodePath, nodeId, projectId));
                }
            }
            if (Boolean.TRUE.equals(config.get("previewOnly")) || "preview".equals(text(config.get("executionMode")))) {
                issues.add(issue("NODE_PREVIEW_ONLY", "blocked_by_policy", "预览节点不能发布为可执行流程", nodePath, nodeId, projectId));
            }
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("valid", issues.isEmpty());
        result.put("status", issues.isEmpty() ? "valid" : "blocked");
        result.put("readiness", overall(issues));
        result.put("issues", issues);
        result.put("checkedRevision", null);
        return result;
    }

    private static Map<String, Object> issue(String code, String status, String message, String path, String nodeId, String projectId) {
        var route = projectId == null || projectId.isBlank() ? "/setup" : "/projects/" + projectId + "/orchestration";
        return Map.of("code", code, "status", status, "message", message == null ? "工作流校验失败" : message,
                "path", path, "severity", "blocked_by_policy".equals(status) ? "error" : "warning",
                "affectedObject", Map.of("type", "workflow_node", "id", nodeId),
                "remediationRoute", route, "evidence", Map.of());
    }

    private static String overall(List<Map<String, Object>> issues) {
        if (issues.isEmpty()) return "ready";
        if (issues.stream().anyMatch(value -> "blocked_by_policy".equals(text(value.get("status"))))) return "blocked_by_policy";
        if (issues.stream().anyMatch(value -> "needs_approval".equals(text(value.get("status"))))) return "needs_approval";
        if (issues.stream().anyMatch(value -> "missing_resource".equals(text(value.get("status"))))) return "missing_resource";
        if (issues.stream().anyMatch(value -> "degraded".equals(text(value.get("status"))))) return "degraded";
        return "unknown";
    }

    private static Map<String, Object> parseMap(Object value, ObjectMapper mapper) {
        try { return mapper.readValue(text(value), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception ignored) { return Map.of(); }
    }

    public static Map<String, Object> node(Object raw) {
        return object(raw);
    }

    private static Map<String, Object> hydrateSourcePlatforms(Map<String, Object> input, String ownerId,
                                                               String projectId, JdbcTemplate jdbc, ObjectMapper mapper) {
        var result = new LinkedHashMap<String, Object>(input);
        var hydratedNodes = new ArrayList<Object>();
        for (var raw : array(input.get("nodes"))) {
            var node = new LinkedHashMap<String, Object>(object(raw));
            if ("source".equals(text(node.get("type")))) {
                var config = new LinkedHashMap<String, Object>(object(node.get("config")));
                var sourceId = text(config.get("sourceId"));
                if (!sourceId.isBlank() && text(config.get("platform")).isBlank()) {
                    var rows = jdbc.queryForList("""
                            SELECT kind,config_json FROM project_sources
                            WHERE id=? AND project_id=? AND owner_id=? AND archived_at IS NULL
                            """, sourceId, projectId, ownerId);
                    if (!rows.isEmpty()) {
                        var source = rows.get(0);
                        var sourceConfig = parseMap(source.get("config_json"), mapper);
                        var sourcePlatform = text(sourceConfig.get("platform"));
                        if (sourcePlatform.isBlank()) sourcePlatform = text(source.get("kind"));
                        if (!sourcePlatform.isBlank()) config.put("platform", sourcePlatform);
                    }
                }
                node.put("config", config);
            }
            hydratedNodes.add(node);
        }
        result.put("nodes", hydratedNodes);
        return result;
    }
}
