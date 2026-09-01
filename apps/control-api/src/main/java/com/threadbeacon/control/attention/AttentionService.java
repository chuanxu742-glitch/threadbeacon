package com.threadbeacon.control.attention;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.workspace.V2Cursor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

/**
 * Attention is a projection. Its resolve/ignore state never changes the source
 * Run, Finding, Report or Delivery history.
 */
@Service
public class AttentionService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    public AttentionService(JdbcTemplate jdbc, TransactionTemplate transactions) {
        this.jdbc = jdbc;
        this.transactions = transactions;
    }

    public Map<String, Object> list(String ownerId, String projectId, String requestedStatus, int limit) {
        return list(ownerId, projectId, requestedStatus, limit, "");
    }

    public Map<String, Object> list(String ownerId, String projectId, String requestedStatus, int limit, String cursor) {
        var filterProject = projectId == null ? "" : projectId.trim();
        if (!filterProject.isBlank() && jdbc.queryForList("SELECT 1 FROM projects WHERE id=? AND owner_id=?",
                filterProject, ownerId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "项目不存在");
        }
        refresh(ownerId, filterProject);
        var status = requestedStatus == null ? "open" : requestedStatus.trim().toLowerCase();
        if (!Set.of("open", "resolved", "ignored", "all").contains(status)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "status 必须是 open、resolved、ignored 或 all");
        }
        var boundedLimit = bounded(limit, 1, 500);
        var offset = V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT * FROM attention_items
                WHERE owner_id=? AND (?='' OR project_id=?) AND (?='all' OR status=?)
                ORDER BY CASE severity WHEN 5 THEN 0 WHEN 4 THEN 1 WHEN 3 THEN 2 ELSE 3 END,
                         updated_at DESC,id DESC LIMIT ? OFFSET ?
                """, ownerId, filterProject, filterProject, status, status, boundedLimit + 1, offset);
        var hasMore = rows.size() > boundedLimit;
        if (hasMore) rows = new java.util.ArrayList<>(rows.subList(0, boundedLimit));
        for (var row : rows) decorate(row);
        var result = new LinkedHashMap<String, Object>();
        result.put("items", rows);
        result.put("attention", rows);
        result.put("status", status);
        result.put("total", rows.size());
        result.put("limit", boundedLimit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + boundedLimit) : null);
        return result;
    }

    public Map<String, Object> update(String ownerId, String userId, String itemId, Map<String, Object> body) {
        var action = text(body.get("action")).toLowerCase();
        if (action.isBlank()) action = text(body.get("status")).toLowerCase();
        if ("resolved".equals(action)) action = "resolve";
        if ("ignored".equals(action)) action = "ignore";
        if (!Set.of("resolve", "ignore").contains(action)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "action 必须是 resolve 或 ignore");
        }
        var reason = text(body.get("reason"));
        var finalAction = action;
        var timestamp = now();
        var changed = transactions.execute(status -> {
            var updated = jdbc.update("""
                    UPDATE attention_items
                    SET status=?,resolved_by=?,resolution_reason=?,resolved_at=?,updated_at=?
                    WHERE id=? AND owner_id=?
                    """, "resolve".equals(finalAction) ? "resolved" : "ignored", userId, reason,
                    timestamp, timestamp, itemId, ownerId);
            if (updated == 1) {
                jdbc.update("""
                        INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                        VALUES(?,?,?,?,?,?,?)
                        """, id(), ownerId, "attention." + finalAction, "attention_item", itemId,
                        "{\"action\":\"" + finalAction + "\"}", timestamp);
            }
            return updated;
        });
        if (changed != 1) throw new ApiException(HttpStatus.NOT_FOUND, "待处理项不存在");
        var rows = jdbc.queryForList("SELECT * FROM attention_items WHERE id=? AND owner_id=?", itemId, ownerId);
        var item = rows.get(0);
        decorate(item);
        return item;
    }

    public Map<String, Object> item(String ownerId, String itemId) {
        var rows = jdbc.queryForList("SELECT * FROM attention_items WHERE id=? AND owner_id=?", itemId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "待处理项不存在");
        var item = rows.get(0);
        decorate(item);
        return item;
    }

    private void refresh(String ownerId, String projectId) {
        transactions.executeWithoutResult(status -> {
            var activeKeys = new HashSet<String>();
            var failedJobs = jdbc.queryForList("""
                    SELECT j.id,j.project_id,j.workflow_run_id,j.platform,j.keyword,j.last_error
                    FROM jobs j
                    WHERE j.owner_id=? AND j.status='failed' AND (?='' OR j.project_id=?)
                    """, ownerId, projectId, projectId);
            for (var row : failedJobs) {
                var sourceId = text(row.get("workflow_run_id"));
                var sourceType = sourceId.isBlank() ? "job" : "run";
                if (sourceId.isBlank()) sourceId = text(row.get("id"));
                var dedup = sourceType + ":failed:" + sourceId;
                activeKeys.add(dedup);
                upsert(ownerId, nullable(text(row.get("project_id"))), "run.failed", sourceType, sourceId,
                        dedup, "运行失败", "平台 " + text(row.get("platform")) + "：" + text(row.get("last_error")),
                        4, projectRoute(row.get("project_id"), "operations"));
            }

            var blockedRuns = jdbc.queryForList("""
                    SELECT r.id,w.project_id,r.status,r.last_error
                    FROM workflow_runs r
                    JOIN workflows w ON w.id=r.workflow_id
                    WHERE r.owner_id=? AND r.status IN ('failed','blocked','waiting_review','awaiting_confirmation')
                      AND (?='' OR w.project_id=?)
                    """, ownerId, projectId, projectId);
            for (var row : blockedRuns) {
                var runId = text(row.get("id"));
                var runStatus = text(row.get("status"));
                var dedup = "run:" + runStatus + ":" + runId;
                if (!activeKeys.add(dedup)) continue;
                var waiting = Set.of("waiting_review", "awaiting_confirmation").contains(runStatus);
                upsert(ownerId, nullable(text(row.get("project_id"))), waiting ? "run.review" : "run.failed",
                        "run", runId, dedup, waiting ? "运行等待复核" : "运行被阻断",
                        text(row.get("last_error")), waiting ? 3 : 4,
                        projectRoute(row.get("project_id"), "operations"));
            }

            var pendingFindings = jdbc.queryForList("""
                    SELECT id,project_id,theme,summary,severity
                    FROM evidence
                    WHERE owner_id=? AND review_status='pending' AND (?='' OR project_id=?)
                    """, ownerId, projectId, projectId);
            for (var row : pendingFindings) {
                var findingId = text(row.get("id"));
                var dedup = "finding:review:" + findingId;
                activeKeys.add(dedup);
                upsert(ownerId, nullable(text(row.get("project_id"))), "finding.review", "finding", findingId,
                        dedup, "Finding 待复核", text(row.get("theme")) + "：" + text(row.get("summary")),
                        Math.max(2, Math.min(5, integer(row.get("severity"), 2))),
                        projectRoute(row.get("project_id"), "data"));
            }

            var drafts = jdbc.queryForList("""
                    SELECT id,project_id,title FROM report_drafts
                    WHERE owner_id=? AND status='draft' AND (?='' OR project_id=?)
                    """, ownerId, projectId, projectId);
            for (var row : drafts) {
                var draftId = text(row.get("id"));
                var dedup = "report:draft:" + draftId;
                activeKeys.add(dedup);
                upsert(ownerId, nullable(text(row.get("project_id"))), "report.review", "report_draft", draftId,
                        dedup, "报告草稿待发布", text(row.get("title")), 2,
                        projectRoute(row.get("project_id"), "delivery"));
            }

            var incompleteReports = jdbc.queryForList("""
                    SELECT id,project_id,title FROM report_versions
                    WHERE owner_id=? AND evidence_complete=0 AND (?='' OR project_id=?)
                    """, ownerId, projectId, projectId);
            for (var row : incompleteReports) {
                var reportId = text(row.get("id"));
                var dedup = "report:incomplete:" + reportId;
                activeKeys.add(dedup);
                upsert(ownerId, nullable(text(row.get("project_id"))), "report.evidence", "report", reportId,
                        dedup, "报告证据不完整", "正式报告包含未能回溯的证据引用", 4,
                        projectRoute(row.get("project_id"), "delivery"));
            }

            var deliveries = jdbc.queryForList("""
                    SELECT id,project_id,status,kind FROM delivery_operations
                    WHERE owner_id=? AND status IN ('failed','unknown') AND (?='' OR project_id=?)
                    """, ownerId, projectId, projectId);
            for (var row : deliveries) {
                var operationId = text(row.get("id"));
                var dedup = "delivery:" + operationId;
                activeKeys.add(dedup);
                upsert(ownerId, nullable(text(row.get("project_id"))), "delivery." + text(row.get("status")),
                        "delivery_operation", operationId, dedup, "交付需要处理",
                        text(row.get("kind")) + " 结果为 " + text(row.get("status")), 4,
                        projectRoute(row.get("project_id"), "delivery"));
            }
            closeCleared(ownerId, projectId, activeKeys);
        });
    }

    private void upsert(String ownerId, String projectId, String kind, String sourceType, String sourceId,
                        String dedupKey, String title, String message, int severity, String route) {
        var timestamp = now();
        jdbc.update("""
                INSERT INTO attention_items
                  (id,owner_id,project_id,kind,source_type,source_id,dedup_key,title,message,severity,
                   remediation_route,status,resolution_reason,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,'open','',?,?)
                ON CONFLICT(owner_id,dedup_key) DO UPDATE SET
                  project_id=excluded.project_id,kind=excluded.kind,source_type=excluded.source_type,
                  source_id=excluded.source_id,title=excluded.title,message=excluded.message,
                  severity=excluded.severity,remediation_route=excluded.remediation_route,updated_at=excluded.updated_at
                """, id(), ownerId, projectId, kind, sourceType, sourceId, dedupKey, title,
                truncate(message), Math.max(0, Math.min(5, severity)), route, timestamp, timestamp);
    }

    private void closeCleared(String ownerId, String projectId, Set<String> activeKeys) {
        var rows = jdbc.queryForList("""
                SELECT id,dedup_key FROM attention_items
                WHERE owner_id=? AND status='open' AND (?='' OR project_id=? )
                """, ownerId, projectId, projectId);
        var timestamp = now();
        for (var row : rows) {
            if (!activeKeys.contains(text(row.get("dedup_key")))) {
                jdbc.update("""
                        UPDATE attention_items
                        SET status='resolved',resolution_reason='权威对象已不再需要处理',resolved_at=?,updated_at=?
                        WHERE id=? AND owner_id=? AND status='open'
                        """, timestamp, timestamp, row.get("id"), ownerId);
            }
        }
    }

    private void decorate(Map<String, Object> item) {
        item.put("attentionId", item.get("id"));
        item.put("affectedObject", Map.of("type", text(item.get("source_type")), "id", text(item.get("source_id"))));
        item.put("resolved", Set.of("resolved", "ignored").contains(text(item.get("status"))));
    }

    private String projectRoute(Object projectId, String suffix) {
        var value = text(projectId);
        return value.isBlank() ? "/today" : "/projects/" + value + "/" + suffix;
    }

    private String nullable(String value) { return value.isBlank() ? null : value; }
    private int bounded(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private String truncate(String value) { return value.length() <= 2000 ? value : value.substring(0, 2000); }
}
