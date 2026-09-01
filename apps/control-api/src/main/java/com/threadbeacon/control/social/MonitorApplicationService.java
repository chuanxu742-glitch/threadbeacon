package com.threadbeacon.control.social;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.project.ProjectV2Service;
import com.threadbeacon.control.workspace.V2ApiException;
import com.threadbeacon.control.workspace.V2Cursor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.bool;
import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

/** Write-side application service for project social monitors/watches. */
@Service
public class MonitorApplicationService {
    private static final Set<String> STATUSES = Set.of("active", "paused", "error", "disabled");
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final CurrentUser user;
    private final ProjectV2Service projects;
    private final SocialRepository repository;
    private final SocialProjectionMapper projections;
    private final SocialAlertService alerts;

    public MonitorApplicationService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper mapper,
                                     CurrentUser user, ProjectV2Service projects, SocialRepository repository,
                                     SocialProjectionMapper projections, SocialAlertService alerts) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper;
        this.user = user;
        this.projects = projects;
        this.repository = repository;
        this.projections = projections;
        this.alerts = alerts;
    }

    public Map<String, Object> list(String projectId, String status, String type, String search,
                                    int requestedLimit, String cursor) {
        var ownerId = user.ownerId();
        projects.project(ownerId, projectId);
        var normalizedStatus = normalizeStatus(status);
        var normalizedType = type == null || type.isBlank() ? "" : SocialV2Policy.type(type);
        if (type != null && !type.isBlank() && normalizedType.isBlank()) {
            throw bad("INVALID_MONITOR_TYPE", "监视器类型只允许 keyword、account 或 topic");
        }
        var limit = bounded(requestedLimit, 1, 100);
        var offset = V2Cursor.offset(cursor);
        var rows = repository.monitors(ownerId, projectId, limit + 1, normalizedStatus, normalizedType, search);
        var hasMore = rows.size() > limit;
        var values = rows.stream().limit(limit).map(this::projection).toList();
        var result = new LinkedHashMap<String, Object>();
        result.put("projectId", projectId);
        result.put("monitors", values);
        result.put("items", values);
        result.put("limit", limit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + limit) : null);
        return result;
    }

    public Map<String, Object> create(String projectId, Map<String, Object> body, String requestKey) {
        var ownerId = user.ownerId();
        var project = projects.project(ownerId, projectId);
        if ("archived".equals(text(project.get("status")))) throw conflict("PROJECT_ARCHIVED", "已归档项目不能新增社媒监视器");
        body = body == null ? Map.of() : body;
        var name = text(body.get("name"));
        if (name.isBlank() || name.length() > 100) throw bad("INVALID_MONITOR_NAME", "监视器名称长度必须是 1-100 个字符");
        var type = SocialV2Policy.type(body.containsKey("type") ? body.get("type")
                : body.containsKey("monitorType") ? body.get("monitorType") : body.get("kind"));
        if (type.isBlank()) throw bad("INVALID_MONITOR_TYPE", "监视器类型只允许 keyword、account 或 topic");
        var config = config(body);
        var query = text(body.get("query"));
        if (query.isBlank()) query = text(body.get("keyword"));
        requireTerms(type, query, config);
        var sourceId = text(body.get("sourceId"));
        if (!sourceId.isBlank()) requireSource(ownerId, projectId, sourceId);
        var interval = integer(body.get("intervalMinutes"), 60);
        if (interval < 1 || interval > 10080) throw bad("INVALID_MONITOR_INTERVAL", "intervalMinutes 必须是 1-10080");
        var status = body.containsKey("enabled") && !bool(body.get("enabled"), true) ? "paused" : text(body.get("status"));
        if (status.isBlank()) status = "active";
        if (!Set.of("active", "paused").contains(status)) throw bad("INVALID_MONITOR_STATUS", "新监视器状态只允许 active 或 paused");
        var key = text(requestKey);
        if (key.isBlank()) key = text(body.get("idempotencyKey"));
        if (key.length() > 200) throw bad("INVALID_IDEMPOTENCY_KEY", "幂等键长度不能超过 200");
        if (!key.isBlank()) {
            var existing = findByIdempotency(ownerId, projectId, key);
            if (!existing.isEmpty()) return result(existing.get(0), true);
        }
        var monitorId = id();
        var timestamp = now();
        final String finalKey = key.isBlank() ? null : key;
        final String finalProjectId = projectId;
        final String finalOwnerId = ownerId;
        final String finalName = name;
        final String finalType = type;
        final String finalQuery = query;
        final Map<String, Object> finalConfig = config;
        final String finalSourceId = sourceId;
        final int finalInterval = interval;
        final String finalStatus = status;
        try {
            transactions.executeWithoutResult(ignored -> {
                jdbc.update("""
                        INSERT INTO social_monitors
                          (id,project_id,owner_id,name,monitor_type,query,config_json,source_id,
                           interval_minutes,status,revision,idempotency_key,created_at,updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)
                        """, monitorId, finalProjectId, finalOwnerId, finalName, finalType, finalQuery, json(mapper, finalConfig),
                        finalSourceId.isBlank() ? null : finalSourceId, finalInterval, finalStatus, finalKey, timestamp, timestamp);
                repository.audit(finalOwnerId, "social.monitor.create", monitorId,
                        Map.of("projectId", finalProjectId, "type", finalType, "status", finalStatus));
            });
        } catch (DuplicateKeyException error) {
            if (finalKey != null) {
                var existing = findByIdempotency(ownerId, projectId, finalKey);
                if (!existing.isEmpty()) return result(existing.get(0), true);
            }
            throw conflict("MONITOR_NAME_CONFLICT", "项目内已存在同名监视器");
        }
        var response = result(requireMonitor(ownerId, projectId, monitorId), false);
        alerts.refreshMonitor(projectId, monitorId);
        return response;
    }

    public Map<String, Object> detail(String projectId, String monitorId) {
        return result(requireMonitor(user.ownerId(), projectId, monitorId), false);
    }

    public Map<String, Object> update(String projectId, String monitorId, Map<String, Object> body) {
        var ownerId = user.ownerId();
        var current = requireMonitor(ownerId, projectId, monitorId);
        body = body == null ? Map.of() : body;
        var expectedRevision = body.containsKey("revision") ? integer(body.get("revision"), -1) : -1;
        var expectedUpdatedAt = text(body.get("updatedAt"));
        if (expectedRevision < 1 && expectedUpdatedAt.isBlank()) throw bad("REVISION_REQUIRED", "更新监视器必须携带 revision 或 updatedAt");
        var name = body.containsKey("name") ? text(body.get("name")) : text(current.get("name"));
        if (name.isBlank() || name.length() > 100) throw bad("INVALID_MONITOR_NAME", "监视器名称长度必须是 1-100 个字符");
        var type = body.containsKey("type") ? SocialV2Policy.type(body.get("type"))
                : body.containsKey("monitorType") ? SocialV2Policy.type(body.get("monitorType"))
                : text(current.get("monitor_type"));
        if (type.isBlank()) throw bad("INVALID_MONITOR_TYPE", "监视器类型只允许 keyword、account 或 topic");
        var config = new LinkedHashMap<String, Object>(body.containsKey("config")
                ? asMap(body.get("config")) : SocialV2Policy.parseMap(current.get("config_json"), mapper));
        for (var key : List.of("keywords", "topics", "terms", "handles", "accounts", "platforms", "handle", "username", "severity")) {
            if (body.containsKey(key)) config.put(key, body.get(key));
        }
        config = new LinkedHashMap<>(SocialV2Policy.sanitize(config));
        var query = body.containsKey("query") ? text(body.get("query")) : text(current.get("query"));
        if (query.isBlank() && body.containsKey("keyword")) query = text(body.get("keyword"));
        requireTerms(type, query, config);
        var sourceId = body.containsKey("sourceId") ? text(body.get("sourceId")) : text(current.get("source_id"));
        if (!sourceId.isBlank()) requireSource(ownerId, projectId, sourceId);
        var interval = body.containsKey("intervalMinutes") ? integer(body.get("intervalMinutes"), -1) : integer(current.get("interval_minutes"), 60);
        if (interval < 1 || interval > 10080) throw bad("INVALID_MONITOR_INTERVAL", "intervalMinutes 必须是 1-10080");
        var action = text(body.get("action")).toLowerCase(Locale.ROOT);
        var status = text(body.get("status")).toLowerCase(Locale.ROOT);
        if ("enable".equals(action) || "resume".equals(action)) status = "active";
        if ("pause".equals(action)) status = "paused";
        if ("disable".equals(action)) status = "disabled";
        if (body.containsKey("enabled")) status = bool(body.get("enabled"), true) ? "active" : "paused";
        if (status.isBlank()) status = text(current.get("status"));
        if (!STATUSES.contains(status)) throw bad("INVALID_MONITOR_STATUS", "监视器状态无效");
        var timestamp = now();
        int changed;
        if (expectedRevision >= 1) {
            changed = jdbc.update("""
                    UPDATE social_monitors SET name=?,monitor_type=?,query=?,config_json=?,source_id=?,
                           interval_minutes=?,status=?,revision=revision+1,updated_at=?
                    WHERE id=? AND project_id=? AND owner_id=? AND archived_at IS NULL AND revision=?
                    """, name, type, query, json(mapper, config), sourceId.isBlank() ? null : sourceId,
                    interval, status, timestamp, monitorId, projectId, ownerId, expectedRevision);
        } else {
            changed = jdbc.update("""
                    UPDATE social_monitors SET name=?,monitor_type=?,query=?,config_json=?,source_id=?,
                           interval_minutes=?,status=?,revision=revision+1,updated_at=?
                    WHERE id=? AND project_id=? AND owner_id=? AND archived_at IS NULL AND updated_at=?
                    """, name, type, query, json(mapper, config), sourceId.isBlank() ? null : sourceId,
                    interval, status, timestamp, monitorId, projectId, ownerId, expectedUpdatedAt);
        }
        if (changed != 1) throw conflict("REVISION_CONFLICT", "监视器已被其他请求修改，请刷新后重试");
        repository.audit(ownerId, "social.monitor.update", monitorId, Map.of("projectId", projectId, "status", status));
        var response = result(requireMonitor(ownerId, projectId, monitorId), false);
        alerts.refreshMonitor(projectId, monitorId);
        return response;
    }

    public Map<String, Object> delete(String projectId, String monitorId, Integer revision) {
        var ownerId = user.ownerId();
        var current = requireMonitor(ownerId, projectId, monitorId);
        if (!text(current.get("archived_at")).isBlank()) return result(current, false);
        var timestamp = now();
        var changed = revision == null
                ? jdbc.update("""
                    UPDATE social_monitors SET status='disabled',archived_at=?,revision=revision+1,updated_at=?
                    WHERE id=? AND project_id=? AND owner_id=? AND archived_at IS NULL
                    """, timestamp, timestamp, monitorId, projectId, ownerId)
                : jdbc.update("""
                    UPDATE social_monitors SET status='disabled',archived_at=?,revision=revision+1,updated_at=?
                    WHERE id=? AND project_id=? AND owner_id=? AND archived_at IS NULL AND revision=?
                    """, timestamp, timestamp, monitorId, projectId, ownerId, revision);
        if (changed != 1) throw conflict("REVISION_CONFLICT", "监视器已被其他请求修改，请刷新后重试");
        repository.audit(ownerId, "social.monitor.delete", monitorId, Map.of("projectId", projectId));
        return result(requireMonitor(ownerId, projectId, monitorId), false);
    }

    public Map<String, Object> action(String projectId, String monitorId, String action, Map<String, Object> body) {
        var normalized = action == null ? "" : action.trim().toLowerCase(Locale.ROOT);
        if (!Set.of("enable", "disable", "pause", "resume").contains(normalized)) throw bad("INVALID_MONITOR_ACTION", "监视器操作只允许 enable、disable、pause 或 resume");
        var payload = new LinkedHashMap<String, Object>(body == null ? Map.of() : body);
        payload.put("action", normalized);
        if (!payload.containsKey("revision") && !payload.containsKey("updatedAt")) {
            payload.put("revision", integer(requireMonitor(user.ownerId(), projectId, monitorId).get("revision"), 1));
        }
        var result = update(projectId, monitorId, payload);
        result.put("action", normalized);
        return result;
    }

    private Map<String, Object> result(Map<String, Object> row, boolean reused) {
        var projection = projection(row);
        var result = new LinkedHashMap<String, Object>();
        result.put("monitor", projection); result.put("watch", projection); result.put("reused", reused);
        return result;
    }

    private Map<String, Object> projection(Map<String, Object> row) {
        return projections.monitor(row, repository.alertCount(text(row.get("id")), ""), repository.alertCount(text(row.get("id")), "open"));
    }

    private Map<String, Object> requireMonitor(String ownerId, String projectId, String monitorId) {
        var row = repository.monitor(ownerId, projectId, monitorId);
        if (row == null) throw new V2ApiException(HttpStatus.NOT_FOUND, "SOCIAL_MONITOR_NOT_FOUND", "社媒监视器不存在");
        return row;
    }

    private List<Map<String, Object>> findByIdempotency(String ownerId, String projectId, String key) {
        return jdbc.queryForList("SELECT * FROM social_monitors WHERE owner_id=? AND project_id=? AND idempotency_key=?", ownerId, projectId, key);
    }

    private void requireSource(String ownerId, String projectId, String sourceId) {
        if (jdbc.queryForList("""
                SELECT id FROM project_sources WHERE id=? AND project_id=? AND owner_id=? AND archived_at IS NULL
                """, sourceId, projectId, ownerId).isEmpty()) throw bad("SOURCE_NOT_FOUND", "监视器关联的数据源不存在或不属于当前项目");
    }

    private Map<String, Object> config(Map<String, Object> body) {
        var value = new LinkedHashMap<String, Object>();
        if (body.get("config") instanceof Map<?, ?> map) value.putAll(asMap(map));
        for (var key : List.of("keywords", "topics", "terms", "handles", "accounts", "platforms", "handle", "username", "severity")) {
            if (body.containsKey(key)) value.put(key, body.get(key));
        }
        return SocialV2Policy.sanitize(value);
    }

    private Map<String, Object> asMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) return Map.of();
        var result = new LinkedHashMap<String, Object>();
        for (var entry : map.entrySet()) if (entry.getKey() instanceof String key) result.put(key, entry.getValue());
        return result;
    }

    private void requireTerms(String type, String query, Map<String, Object> config) {
        if (SocialV2Policy.terms(type, query, config).isEmpty()) throw bad("MONITOR_QUERY_REQUIRED", "监视器必须至少提供 query、keyword、account 或 topic");
    }

    private String normalizeStatus(String status) {
        var value = status == null ? "" : status.trim().toLowerCase(Locale.ROOT);
        if (value.isBlank() || "all".equals(value)) return "";
        if (!STATUSES.contains(value)) throw bad("INVALID_MONITOR_STATUS", "监视器状态无效");
        return value;
    }

    private int bounded(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private V2ApiException bad(String code, String message) { return new V2ApiException(HttpStatus.BAD_REQUEST, code, message); }
    private V2ApiException conflict(String code, String message) { return new V2ApiException(HttpStatus.CONFLICT, code, message); }
}
