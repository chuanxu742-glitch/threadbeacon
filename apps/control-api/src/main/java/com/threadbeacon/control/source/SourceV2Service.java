package com.threadbeacon.control.source;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.job.JobService;
import com.threadbeacon.control.project.ProjectV2Service;
import com.threadbeacon.control.workspace.V2ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.net.InetAddress;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static com.threadbeacon.control.common.Values.array;
import static com.threadbeacon.control.common.Values.bool;
import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

@Service
public class SourceV2Service {
    private static final Set<String> KINDS = Set.of("native", "opencli", "rss", "rest", "web");
    private static final Pattern SECRET_KEY = Pattern.compile("(?:^|[-_])(password|passwd|secret|token|api[-_]?key|authorization|cookie|credential)(?:$|[-_])", Pattern.CASE_INSENSITIVE);
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final CurrentUser user;
    private final ProjectV2Service projects;
    private final JobService jobs;

    public SourceV2Service(JdbcTemplate jdbc, ObjectMapper mapper, CurrentUser user,
                           ProjectV2Service projects, JobService jobs) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.user = user;
        this.projects = projects;
        this.jobs = jobs;
    }

    public Map<String, Object> list(String projectId, int requestedLimit, String cursor) {
        var project = projects.project(user.ownerId(), projectId);
        var limit = Math.max(1, Math.min(100, requestedLimit));
        var offset = com.threadbeacon.control.workspace.V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT s.*,c.cursor_json,c.last_success_at,c.last_job_id,c.consecutive_failures,c.last_error,
                       c.updated_at AS cursor_updated_at
                FROM project_sources s LEFT JOIN project_source_cursors c ON c.source_id=s.id
                WHERE s.project_id=? AND s.owner_id=? AND s.archived_at IS NULL
                ORDER BY s.updated_at DESC,s.id DESC LIMIT ? OFFSET ?
                """, projectId, user.ownerId(), limit + 1, offset);
        var hasMore = rows.size() > limit;
        var sources = rows.stream().limit(limit).map(this::projection).toList();
        var result = new LinkedHashMap<String, Object>();
        result.put("projectId", project.get("id"));
        result.put("sources", sources);
        result.put("limit", limit);
        result.put("nextCursor", hasMore ? com.threadbeacon.control.workspace.V2Cursor.next(offset + limit) : null);
        return result;
    }

    public Map<String, Object> create(String projectId, Map<String, Object> body) {
        var project = projects.project(user.ownerId(), projectId);
        if ("archived".equals(text(project.get("status")))) {
            throw new V2ApiException(HttpStatus.CONFLICT, "PROJECT_ARCHIVED", "已归档项目不能新增数据源");
        }
        var name = text(body.get("name"));
        var kind = text(body.get("kind")).toLowerCase();
        if (name.isBlank() || name.length() > 100) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_SOURCE_NAME", "数据源名称长度必须是 1-100 个字符");
        }
        if (!KINDS.contains(kind)) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_SOURCE_KIND", "数据源类型不受支持",
                    Map.of("allowed", KINDS));
        }
        var input = body.get("config");
        if (!(input instanceof Map<?, ?>)) input = Map.of();
        @SuppressWarnings("unchecked") var configInput = new LinkedHashMap<String, Object>((Map<String, Object>) input);
        for (var key : List.of("url", "endpoint", "platform", "keyword", "limit", "includeComments")) {
            if (body.containsKey(key)) configInput.put(key, body.get(key));
        }
        var sanitized = sanitizeMap(configInput);
        var endpoint = text(sanitized.get("endpoint"));
        if (endpoint.isBlank()) endpoint = text(sanitized.get("url"));
        if (Set.of("rss", "rest", "web").contains(kind)) {
            validatePublicUrl(endpoint);
            sanitized.put("url", endpoint);
            sanitized.remove("endpoint");
        } else if (!endpoint.isBlank()) {
            var platform = kind.equals("opencli") && !endpoint.startsWith("opencli:") ? "opencli:" + endpoint : endpoint;
            sanitized.put("platform", platform);
            sanitized.remove("endpoint");
        }
        var connectionId = text(body.get("connectionId"));
        if (!connectionId.isBlank()) {
            var connections = jdbc.queryForList("""
                    SELECT c.id FROM connections c JOIN projects p ON p.workspace_id=c.workspace_id
                    WHERE c.id=? AND c.owner_id=? AND p.id=?
                    """, connectionId, user.ownerId(), projectId);
            if (connections.isEmpty()) throw new V2ApiException(HttpStatus.BAD_REQUEST, "CONNECTION_NOT_FOUND", "连接不存在或不属于当前项目工作区");
            sanitized.put("connectionId", connectionId);
        }
        var sourceId = id();
        var timestamp = now();
        jdbc.update("""
                INSERT INTO project_sources(id,project_id,owner_id,name,kind,config_json,status,connection_id,revision,health_json,created_at,updated_at)
                VALUES(?,?,?,?,?,?,'configured',?,1,?,?,?)
                """, sourceId, projectId, user.ownerId(), name, kind, json(mapper, sanitized),
                connectionId.isBlank() ? null : connectionId, "{}", timestamp, timestamp);
        audit("source.create", sourceId, Map.of("projectId", projectId, "kind", kind,
                "secretFieldsRemoved", removedSecretFieldCount(configInput, sanitized)));
        return Map.of("source", projection(jdbc.queryForMap("SELECT * FROM project_sources WHERE id=?", sourceId)));
    }

    public Map<String, Object> probe(String projectId, String sourceId) {
        projects.project(user.ownerId(), projectId);
        var rows = jdbc.queryForList("""
                SELECT s.*,c.cursor_json FROM project_sources s LEFT JOIN project_source_cursors c ON c.source_id=s.id
                WHERE s.id=? AND s.project_id=? AND s.owner_id=? AND s.archived_at IS NULL
                """, sourceId, projectId, user.ownerId());
        if (rows.isEmpty()) throw new V2ApiException(HttpStatus.NOT_FOUND, "SOURCE_NOT_FOUND", "项目数据源不存在");
        var source = rows.get(0);
        var config = sanitizeMap(parseMap(source.get("config_json")));
        var kind = text(source.get("kind"));
        var platform = Set.of("rss", "rest", "web").contains(kind) ? kind : text(config.get("platform"));
        if (kind.equals("opencli") && !platform.startsWith("opencli:") && !platform.isBlank()) platform = "opencli:" + platform;
        if (platform.isBlank()) throw new V2ApiException(HttpStatus.BAD_REQUEST, "SOURCE_PLATFORM_REQUIRED", "数据源缺少可执行 platform");
        var cursor = parseMap(source.get("cursor_json"));
        if (!cursor.isEmpty()) config.put("cursor", cursor);
        var input = new LinkedHashMap<String, Object>();
        input.put("platform", platform);
        input.put("keyword", text(config.get("keyword")).isBlank() ? text(source.get("name")) : text(config.get("keyword")));
        input.put("limit", Math.max(1, Math.min(1000, integer(config.get("limit"), 20))));
        input.put("includeComments", bool(config.get("includeComments"), false));
        var options = new LinkedHashMap<String, Object>();
        options.put("projectId", projectId);
        options.put("sourceId", sourceId);
        options.put("sourceTest", true);
        options.put("config", config);
        final Map<String, Object> job;
        try {
            job = jobs.insert(user.ownerId(), input, options);
        } catch (ApiException error) {
            throw new V2ApiException(error.status(), "SOURCE_PROBE_REJECTED", error.getMessage());
        }
        var timestamp = now();
        jdbc.update("""
                UPDATE project_sources SET status='testing',last_probed_at=?,health_json=?,updated_at=?
                WHERE id=? AND project_id=? AND owner_id=?
                """, timestamp, json(mapper, Map.of("status", "testing", "jobId", job.get("id"))), timestamp,
                sourceId, projectId, user.ownerId());
        jdbc.update("""
                INSERT INTO project_source_cursors(source_id,owner_id,cursor_json,last_job_id,consecutive_failures,updated_at)
                VALUES(?,?,?, ?,0,?)
                ON CONFLICT(source_id) DO UPDATE SET last_job_id=excluded.last_job_id,updated_at=excluded.updated_at
                """, sourceId, user.ownerId(), json(mapper, cursor), job.get("id"), timestamp);
        audit("source.probe", sourceId, Map.of("projectId", projectId, "jobId", job.get("id")));
        var result = new LinkedHashMap<String, Object>();
        result.put("source", projection(jdbc.queryForMap("""
                SELECT s.*,c.cursor_json,c.last_success_at,c.last_job_id,c.consecutive_failures,c.last_error
                FROM project_sources s LEFT JOIN project_source_cursors c ON c.source_id=s.id WHERE s.id=?
                """, sourceId)));
        result.put("job", job);
        return result;
    }

    private Map<String, Object> projection(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id"));
        result.put("projectId", row.get("project_id"));
        result.put("name", row.get("name"));
        result.put("kind", row.get("kind"));
        result.put("status", row.get("status"));
        result.put("revision", row.getOrDefault("revision", 1));
        result.put("config", sanitizeMap(parseMap(row.get("config_json"))));
        result.put("connectionId", row.get("connection_id"));
        result.put("health", parseMap(row.get("health_json")));
        result.put("cursor", parseMap(row.get("cursor_json")));
        result.put("lastSuccessAt", row.get("last_success_at"));
        result.put("lastProbedAt", row.get("last_probed_at"));
        result.put("lastJobId", row.get("last_job_id"));
        result.put("consecutiveFailures", integer(row.get("consecutive_failures"), 0));
        result.put("lastError", row.get("last_error"));
        result.put("createdAt", row.get("created_at"));
        result.put("updatedAt", row.get("updated_at"));
        return result;
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
            } else if (value instanceof List<?> list) {
                result.put(key, list.stream().map(this::sanitizeValue).toList());
            } else result.put(key, value);
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

    private int removedSecretFieldCount(Map<String, Object> original, Map<String, Object> sanitized) {
        var count = 0;
        for (var key : original.keySet()) if (key != null && SECRET_KEY.matcher(key).find() && !sanitized.containsKey(key)) count++;
        return count;
    }

    private Map<String, Object> parseMap(Object raw) {
        try { return mapper.readValue(text(raw), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception ignored) { return Map.of(); }
    }

    private void validatePublicUrl(String value) {
        try {
            var uri = URI.create(value.replace("{keyword}", "threadbeacon").replace("{limit}", "1"));
            var host = uri.getHost();
            if (!Set.of("http", "https").contains(uri.getScheme()) || host == null || uri.getUserInfo() != null || isPrivate(host)) throw new IllegalArgumentException();
        } catch (Exception error) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_SOURCE_URL", "URL 必须是公网 HTTP/HTTPS 地址");
        }
    }

    private boolean isPrivate(String host) {
        var normalized = host.toLowerCase();
        if (normalized.equals("localhost") || normalized.endsWith(".local") || normalized.equals("0.0.0.0") || normalized.equals("::1")) return true;
        try {
            var address = InetAddress.getByName(host);
            return address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress();
        } catch (Exception error) { return true; }
    }

    private void audit(String action, String resourceId, Map<String, Object> details) {
        jdbc.update("""
                INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                VALUES(?,?,?,'project_source',?,?,?)
                """, id(), user.ownerId(), action, resourceId, json(mapper, details), now());
    }
}
