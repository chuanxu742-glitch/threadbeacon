package com.threadbeacon.control.social;

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
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

/** Alert lifecycle and refresh service for social monitor matches. */
@Service
public class SocialAlertService {
    private static final Set<String> STATUSES = Set.of("open", "resolved", "ignored", "all");
    private static final int MAX_MONITORS_PER_REFRESH = 500;
    private static final int MAX_OBSERVATIONS_PER_MONITOR = 200;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper objectMapper;
    private final CurrentUser user;
    private final ProjectV2Service projects;
    private final SocialRepository repository;
    private final SocialProjectionMapper projections;

    public SocialAlertService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper objectMapper,
                              CurrentUser user, ProjectV2Service projects, SocialRepository repository,
                              SocialProjectionMapper projections) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.objectMapper = objectMapper;
        this.user = user;
        this.projects = projects;
        this.repository = repository;
        this.projections = projections;
    }

    public void refreshGlobal() { refresh(user.ownerId(), ""); }

    public void refreshProject(String projectId) {
        projects.project(user.ownerId(), projectId);
        refresh(user.ownerId(), projectId);
    }

    /** Refresh exactly one monitor after its configuration changes. */
    public void refreshMonitor(String projectId, String monitorId) {
        var ownerId = user.ownerId();
        projects.project(ownerId, projectId);
        var monitor = repository.monitor(ownerId, projectId, monitorId);
        if (monitor == null) throw notFound("SOCIAL_MONITOR_NOT_FOUND", "社媒监视器不存在");
        if (!"active".equals(text(monitor.get("status"))) || !text(monitor.get("archived_at")).isBlank()) return;
        refreshMonitors(ownerId, List.of(monitor));
    }

    public Map<String, Object> list(String projectId, String status, String kind, String search,
                                    String monitorId, int requestedLimit, String cursor) {
        var ownerId = user.ownerId();
        projects.project(ownerId, projectId);
        return page(ownerId, projectId, status, kind, search, monitorId, requestedLimit, cursor);
    }

    public Map<String, Object> globalList(String status, String kind, String search,
                                          int requestedLimit, String cursor) {
        var ownerId = user.ownerId();
        return page(ownerId, "", status, kind, search, "", requestedLimit, cursor);
    }

    public Map<String, Object> update(String projectId, String alertId, String action, Map<String, Object> body) {
        var ownerId = user.ownerId();
        projects.project(ownerId, projectId);
        var normalized = action == null ? "" : action.trim().toLowerCase(Locale.ROOT);
        body = body == null ? Map.of() : body;
        if (normalized.isBlank()) normalized = text(body.get("action")).toLowerCase(Locale.ROOT);
        if ("resolved".equals(normalized)) normalized = "resolve";
        if ("ignored".equals(normalized)) normalized = "ignore";
        if (!Set.of("resolve", "ignore").contains(normalized)) throw bad("INVALID_ALERT_ACTION", "告警操作只允许 resolve 或 ignore");
        var expected = body.containsKey("revision") ? integer(body.get("revision"), -1) : -1;
        var reason = text(body.get("reason"));
        var target = "resolve".equals(normalized) ? "resolved" : "ignored";
        var timestamp = now();
        final String finalAction = normalized;
        final String finalProjectId = projectId;
        final String finalOwnerId = ownerId;
        final String finalTarget = target;
        final String finalReason = reason;
        var row = transactions.execute(status -> {
            var rows = jdbc.queryForList("""
                    SELECT * FROM social_alerts WHERE id=? AND project_id=? AND owner_id=? FOR UPDATE
                    """, alertId, finalProjectId, finalOwnerId);
            if (rows.isEmpty()) throw notFound("SOCIAL_ALERT_NOT_FOUND", "社媒告警不存在");
            var current = rows.get(0);
            if (finalTarget.equals(text(current.get("status")))) return current;
            if (expected >= 1 && expected != integer(current.get("revision"), 1)) throw conflict("REVISION_CONFLICT", "告警已被其他请求修改，请刷新后重试");
            jdbc.update("""
                    UPDATE social_alerts
                    SET status=?,resolved_by=?,resolution_reason=?,resolved_at=?,revision=revision+1,updated_at=?
                    WHERE id=? AND project_id=? AND owner_id=?
                    """, finalTarget, user.userId(), finalReason, timestamp, timestamp, alertId, finalProjectId, finalOwnerId);
            repository.audit(finalOwnerId, "social.alert." + finalAction, alertId,
                    Map.of("projectId", finalProjectId, "reason", finalReason));
            return jdbc.queryForMap("SELECT * FROM social_alerts WHERE id=? AND owner_id=?", alertId, finalOwnerId);
        });
        var projection = projections.alert(row);
        return Map.of("alert", projection, "item", projection);
    }

    void refresh(String ownerId, String projectId) {
        var monitors = repository.monitors(ownerId, projectId, MAX_MONITORS_PER_REFRESH, "active", "", "");
        refreshMonitors(ownerId, monitors);
    }

    private void refreshMonitors(String ownerId, List<Map<String, Object>> monitors) {
        if (monitors.isEmpty()) return;
        var timestamp = now();
        transactions.executeWithoutResult(ignored -> {
            for (var monitor : monitors) {
                var monitorProject = text(monitor.get("project_id"));
                var config = SocialV2Policy.parseMap(monitor.get("config_json"), objectMapper);
                var watermark = text(monitor.get("last_run_at"));
                var watermarkId = text(monitor.get("last_run_observation_id"));
                var rows = repository.contentRowsSince(ownerId, monitorProject, watermark, watermarkId,
                        MAX_OBSERVATIONS_PER_MONITOR);
                String latest = null;
                for (var raw : rows) {
                    var value = projections.content(ownerId, raw);
                    var capturedAt = text(value.get("capturedAt"));
                    var observationId = text(value.get("observationId"));
                    if (watermark.isBlank() || capturedAt.compareTo(watermark) > 0
                            || (capturedAt.equals(watermark) && observationId.compareTo(watermarkId) > 0)) {
                        watermark = capturedAt;
                        watermarkId = observationId;
                    }
                    if (!SocialV2Policy.matches(text(monitor.get("monitor_type")), text(monitor.get("query")), config, value)) continue;
                    var dedup = text(monitor.get("id")) + ":" + observationId;
                    var evidence = new LinkedHashMap<String, Object>();
                    evidence.put("observationId", observationId); evidence.put("contentHash", value.get("contentHash"));
                    evidence.put("sourceUrl", value.get("sourceUrl")); evidence.put("platform", value.get("platform"));
                    evidence.put("recordId", value.get("recordId"));
                    var rule = new LinkedHashMap<String, Object>();
                    rule.put("type", monitor.get("monitor_type")); rule.put("query", monitor.get("query"));
                    rule.put("config", SocialV2Policy.sanitize(config));
                    jdbc.update("""
                            INSERT INTO social_alerts
                              (id,project_id,owner_id,monitor_id,observation_id,kind,severity,status,title,message,
                               rule_json,evidence_json,dedup_key,revision,resolution_reason,created_at,updated_at)
                            VALUES(?,?,?,?,?,?,?,'open',?,?,?,?,?,1,'',?,?)
                            ON CONFLICT(owner_id,dedup_key) DO UPDATE SET
                              title=excluded.title,message=excluded.message,rule_json=excluded.rule_json,
                              evidence_json=excluded.evidence_json,updated_at=excluded.updated_at
                            """, id(), monitorProject, ownerId, monitor.get("id"), observationId,
                            "social." + text(monitor.get("monitor_type")), SocialV2Policy.severity(config),
                            "监视器命中：" + text(monitor.get("name")),
                            text(value.get("title")).isBlank() ? text(value.get("content")) : text(value.get("title")),
                            json(objectMapper, rule), json(objectMapper, evidence), dedup, timestamp, timestamp);
                    if (latest == null || text(value.get("capturedAt")).compareTo(latest) > 0) latest = text(value.get("capturedAt"));
                }
                if (latest != null) {
                    jdbc.update("UPDATE social_monitors SET last_run_at=?,last_run_observation_id=?,last_seen_at=?,last_error=NULL,updated_at=? WHERE id=? AND owner_id=?",
                            watermark, watermarkId, latest, timestamp, monitor.get("id"), ownerId);
                } else {
                    if (!watermark.isBlank()) {
                        jdbc.update("UPDATE social_monitors SET last_run_at=?,last_run_observation_id=?,last_error=NULL,updated_at=? WHERE id=? AND owner_id=?",
                                watermark, watermarkId, timestamp, monitor.get("id"), ownerId);
                    }
                }
            }
        });
    }

    private Map<String, Object> page(String ownerId, String projectId, String status, String kind, String search,
                                     String monitorId, int requestedLimit, String cursor) {
        var normalized = status == null || status.isBlank() ? "open" : status.trim().toLowerCase(Locale.ROOT);
        if (!STATUSES.contains(normalized)) throw bad("INVALID_ALERT_STATUS", "告警状态只允许 open、resolved、ignored 或 all");
        var limit = bounded(requestedLimit, 1, 500);
        var offset = V2Cursor.offset(cursor);
        var rows = repository.alerts(ownerId, projectId, normalized, kind, search, monitorId, limit, offset);
        var hasMore = rows.size() > limit;
        var values = rows.stream().limit(limit).map(projections::alert).toList();
        var result = new LinkedHashMap<String, Object>();
        if (!projectId.isBlank()) result.put("projectId", projectId);
        result.put("alerts", values); result.put("items", values); result.put("status", normalized);
        result.put("total", values.size()); result.put("limit", limit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + limit) : null);
        return result;
    }

    private int bounded(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private V2ApiException bad(String code, String message) { return new V2ApiException(HttpStatus.BAD_REQUEST, code, message); }
    private V2ApiException conflict(String code, String message) { return new V2ApiException(HttpStatus.CONFLICT, code, message); }
    private V2ApiException notFound(String code, String message) { return new V2ApiException(HttpStatus.NOT_FOUND, code, message); }
}
