package com.threadbeacon.control.social;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;

/** Narrow persistence adapter for the social monitor/alert boundary. */
@Repository
public class SocialRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public SocialRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<Map<String, Object>> monitors(String ownerId, String projectId, int limit,
                                              String status, String type, String search) {
        var safeProject = projectId == null ? "" : projectId;
        var safeStatus = status == null ? "" : status;
        var safeType = type == null ? "" : type;
        var safeSearch = search == null ? "" : search.trim();
        return jdbc.queryForList("""
                SELECT * FROM social_monitors
                WHERE owner_id=? AND (?='' OR project_id=?) AND archived_at IS NULL
                  AND (?='' OR status=?)
                  AND (?='' OR monitor_type=?)
                  AND (?='' OR lower(name) LIKE lower('%'||?||'%') OR lower(query) LIKE lower('%'||?||'%'))
                ORDER BY updated_at DESC,id DESC LIMIT ?
                """, ownerId, safeProject, safeProject, safeStatus, safeStatus, safeType, safeType,
                safeSearch, safeSearch, safeSearch, Math.max(1, Math.min(501, limit)));
    }

    public Map<String, Object> monitor(String ownerId, String projectId, String monitorId) {
        var rows = jdbc.queryForList("""
                SELECT * FROM social_monitors
                WHERE id=? AND project_id=? AND owner_id=?
                """, monitorId, projectId, ownerId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public List<Map<String, Object>> contentRows(String ownerId, String projectId, String search,
                                                  String platform, String changeType) {
        var safeProject = projectId == null ? "" : projectId;
        var sql = new StringBuilder("""
                SELECT o.id AS observation_id,o.owner_id,o.project_id,o.job_id,o.record_id,
                       o.platform,o.source_item_id,o.content_hash,o.change_type,o.observed_at,
                       o.captured_at,o.source_url,o.payload_json,
                       r.item_type,r.title,r.content,r.author,r.url,r.metrics_json
                FROM observations o JOIN records r ON r.id=o.record_id
                WHERE o.owner_id=? AND ((?='' AND o.project_id IS NOT NULL) OR o.project_id=?)
                """);
        var args = new ArrayList<Object>();
        args.add(ownerId); args.add(safeProject); args.add(safeProject);
        var safeSearch = search == null ? "" : search.trim();
        var safePlatform = platform == null ? "" : platform.trim();
        var safeChange = changeType == null ? "" : changeType.trim();
        if (!safeSearch.isBlank()) {
            sql.append(" AND (lower(COALESCE(r.title,'')) LIKE lower('%'||?||'%') OR lower(COALESCE(r.content,'')) LIKE lower('%'||?||'%') OR lower(COALESCE(r.author,'')) LIKE lower('%'||?||'%'))");
            args.add(safeSearch); args.add(safeSearch); args.add(safeSearch);
        }
        if (!safePlatform.isBlank()) { sql.append(" AND o.platform=?"); args.add(safePlatform); }
        if (!safeChange.isBlank()) {
            if (!java.util.Set.of("baseline", "new", "changed", "unchanged").contains(safeChange)) return List.of();
            sql.append(" AND o.change_type=?"); args.add(safeChange);
        }
        sql.append(" ORDER BY o.captured_at DESC,o.id DESC LIMIT 5000");
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    /**
     * Incremental observation window used by alert refresh.  The caller owns
     * the watermark and deliberately supplies a small hard limit so a monitor
     * change can never turn into a full historical scan.
     */
    public List<Map<String, Object>> contentRowsSince(String ownerId, String projectId, String capturedAfter,
                                                      String observationAfter, int limit) {
        var safeProject = projectId == null ? "" : projectId;
        var after = capturedAfter == null ? "" : capturedAfter.trim();
        var afterId = observationAfter == null ? "" : observationAfter.trim();
        return jdbc.queryForList("""
                SELECT o.id AS observation_id,o.owner_id,o.project_id,o.job_id,o.record_id,
                       o.platform,o.source_item_id,o.content_hash,o.change_type,o.observed_at,
                       o.captured_at,o.source_url,o.payload_json,
                       r.item_type,r.title,r.content,r.author,r.url,r.metrics_json
                FROM observations o JOIN records r ON r.id=o.record_id
                WHERE o.owner_id=? AND ((?='' AND o.project_id IS NOT NULL) OR o.project_id=?)
                  AND (?='' OR o.captured_at>? OR (o.captured_at=? AND o.id>?))
                ORDER BY o.captured_at ASC,o.id ASC LIMIT ?
                """, ownerId, safeProject, safeProject, after, after, after, afterId,
                Math.max(1, Math.min(200, limit)));
    }

    public int alertCount(String monitorId, String status) {
        if (status == null || status.isBlank()) return number("SELECT count(*) FROM social_alerts WHERE monitor_id=?", monitorId);
        return number("SELECT count(*) FROM social_alerts WHERE monitor_id=? AND status=?", monitorId, status);
    }

    public int accountCount(String ownerId, String projectId) {
        var sql = """
                SELECT count(*) FROM (
                  SELECT o.platform,lower(trim(r.author)) AS author
                  FROM observations o JOIN records r ON r.id=o.record_id
                  WHERE %s AND r.author IS NOT NULL AND trim(r.author)<>''
                  GROUP BY o.platform,lower(trim(r.author))
                ) social_accounts
                """.formatted(scopeClause("o", projectId));
        return number(sql, scopeArgs(ownerId, projectId));
    }

    public String latestObservedAt(String ownerId, String projectId) {
        return jdbc.queryForObject("SELECT max(captured_at) FROM observations o WHERE "
                + scopeClause("o", projectId), String.class, scopeArgs(ownerId, projectId));
    }

    public List<Map<String, Object>> alerts(String ownerId, String projectId, String status, String kind,
                                            String search, String monitorId, int limit, int offset) {
        var safeProject = projectId == null ? "" : projectId;
        var safeStatus = status == null || status.isBlank() ? "open" : status;
        var safeKind = kind == null ? "" : kind.trim();
        var safeSearch = search == null ? "" : search.trim();
        var safeMonitor = monitorId == null ? "" : monitorId.trim();
        return jdbc.queryForList("""
                SELECT * FROM social_alerts
                WHERE owner_id=? AND (?='' OR project_id=?)
                  AND (?='all' OR status=?)
                  AND (?='' OR kind=?)
                  AND (?='' OR monitor_id=?)
                  AND (?='' OR lower(title) LIKE lower('%'||?||'%') OR lower(message) LIKE lower('%'||?||'%'))
                ORDER BY CASE severity WHEN 5 THEN 0 WHEN 4 THEN 1 WHEN 3 THEN 2 ELSE 3 END,
                         updated_at DESC,id DESC LIMIT ? OFFSET ?
                """, ownerId, safeProject, safeProject, safeStatus, safeStatus, safeKind, safeKind,
                safeMonitor, safeMonitor, safeSearch, safeSearch, safeSearch,
                Math.max(1, Math.min(501, limit)), Math.max(0, offset));
    }

    public Map<String, Object> alert(String ownerId, String projectId, String alertId) {
        var rows = jdbc.queryForList("""
                SELECT * FROM social_alerts WHERE id=? AND project_id=? AND owner_id=?
                """, alertId, projectId, ownerId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public int number(String sql, Object... args) {
        var result = jdbc.queryForObject(sql, Number.class, args);
        return result == null ? 0 : result.intValue();
    }

    public List<Map<String, Object>> topPlatforms(String ownerId, String projectId) {
        return jdbc.queryForList("""
                SELECT o.platform,count(*) AS content_count,max(o.captured_at) AS latest_seen_at
                FROM observations o WHERE %s
                GROUP BY o.platform ORDER BY content_count DESC,o.platform LIMIT 12
                """.formatted(scopeClause("o", projectId)), scopeArgs(ownerId, projectId));
    }

    public Object[] scopeArgs(String ownerId, String projectId) {
        return projectId == null || projectId.isBlank() ? new Object[]{ownerId} : new Object[]{ownerId, projectId};
    }

    public String scopeClause(String alias, String projectId) {
        return projectId == null || projectId.isBlank()
                ? alias + ".owner_id=? AND " + alias + ".project_id IS NOT NULL"
                : alias + ".owner_id=? AND " + alias + ".project_id=?";
    }

    public int countScoped(String table, String ownerId, String projectId, String extra) {
        var alias = table;
        var conditions = scopeClause(alias, projectId);
        if (extra != null && !extra.isBlank()) conditions += " AND " + extra;
        return number("SELECT count(*) FROM " + table + " " + alias + " WHERE " + conditions,
                scopeArgs(ownerId, projectId));
    }

    public void audit(String ownerId, String action, String resourceId, Map<String, Object> details) {
        jdbc.update("""
                INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                VALUES(?,?,?,'social',?,?,?)
                """, id(), ownerId, action, resourceId, json(mapper, details), now());
    }
}
