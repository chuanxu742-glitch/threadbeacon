package com.threadbeacon.control.research;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.platform.ProductEventService;
import com.threadbeacon.control.workspace.V2Cursor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.array;
import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

/**
 * Application use cases for the immutable research asset boundary.
 *
 * <p>Observations are intentionally read-only here. Records may be updated by the
 * legacy worker projection, but an observation is never used as that projection.
 * Finding edits update the current evidence projection and append a revision.</p>
 */
@Service
public class ResearchService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final ProductEventService productEvents;

    public ResearchService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper mapper,
                           ProductEventService productEvents) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper;
        this.productEvents = productEvents;
    }

    public Map<String, Object> project(String ownerId, String projectId) {
        var rows = jdbc.queryForList("SELECT * FROM projects WHERE id=? AND owner_id=?", projectId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "项目不存在");
        return rows.get(0);
    }

    public List<Map<String, Object>> observations(String ownerId, String projectId, int limit) {
        var page = observationsPage(ownerId, projectId, limit, "");
        @SuppressWarnings("unchecked") var rows = (List<Map<String, Object>>) page.get("observations");
        return rows;
    }

    public Map<String, Object> observationsPage(String ownerId, String projectId, int limit, String cursor) {
        project(ownerId, projectId);
        var boundedLimit = bounded(limit, 1, 500);
        var offset = V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT o.id,o.owner_id,o.project_id,o.workflow_run_id,o.job_id,o.record_id,
                       o.platform,o.source_item_id,o.content_hash,o.change_type,o.observed_at,
                       o.captured_at,o.source_url,o.payload_json,r.title,r.content,r.author,r.url,
                       r.item_type
                FROM observations o
                JOIN records r ON r.id=o.record_id
                WHERE o.owner_id=? AND o.project_id=?
                ORDER BY o.captured_at DESC,o.id DESC LIMIT ? OFFSET ?
                """, ownerId, projectId, boundedLimit + 1, offset);
        var hasMore = rows.size() > boundedLimit;
        if (hasMore) rows = new ArrayList<>(rows.subList(0, boundedLimit));
        for (var row : rows) {
            var payload = parseMap(row.get("payload_json"));
            row.put("payload", payload);
            // Keep the JSON column in responses for clients that need a lossless copy.
            row.put("immutable", true);
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("observations", rows);
        result.put("limit", boundedLimit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + boundedLimit) : null);
        return result;
    }

    public List<Map<String, Object>> findings(String ownerId, String projectId) {
        var page = findingsPage(ownerId, projectId, 500, "");
        @SuppressWarnings("unchecked") var rows = (List<Map<String, Object>>) page.get("findings");
        return rows;
    }

    public Map<String, Object> findingsPage(String ownerId, String projectId, int limit, String cursor) {
        project(ownerId, projectId);
        var boundedLimit = bounded(limit, 1, 500);
        var offset = V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT e.*,COALESCE((SELECT count(*) FROM evidence_links l WHERE l.evidence_id=e.id),0) AS linked_count,
                       fr.id AS revision_id,fr.revision,fr.action AS revision_action,
                       fr.status AS revision_status,fr.reviewer_id AS revision_reviewer_id,
                       fr.theme AS revision_theme,fr.summary AS revision_summary,
                       fr.severity AS revision_severity,fr.rationale AS revision_rationale,
                       fr.created_at AS revision_created_at
                FROM evidence e
                LEFT JOIN LATERAL (
                    SELECT * FROM finding_revisions r
                    WHERE r.finding_id=e.id
                    ORDER BY r.revision DESC
                    LIMIT 1
                ) fr ON TRUE
                WHERE e.owner_id=? AND e.project_id=?
                ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?
                """, ownerId, projectId, boundedLimit + 1, offset);
        var hasMore = rows.size() > boundedLimit;
        if (hasMore) rows = new ArrayList<>(rows.subList(0, boundedLimit));
        for (var finding : rows) enrichFinding(ownerId, finding);
        var result = new LinkedHashMap<String, Object>();
        result.put("findings", rows);
        result.put("limit", boundedLimit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + boundedLimit) : null);
        return result;
    }

    public Map<String, Object> finding(String ownerId, String findingId) {
        var rows = jdbc.queryForList("""
                SELECT e.*,COALESCE((SELECT count(*) FROM evidence_links l WHERE l.evidence_id=e.id),0) AS linked_count,
                       fr.id AS revision_id,fr.revision,fr.action AS revision_action,
                       fr.status AS revision_status,fr.reviewer_id AS revision_reviewer_id,
                       fr.theme AS revision_theme,fr.summary AS revision_summary,
                       fr.severity AS revision_severity,fr.rationale AS revision_rationale,
                       fr.created_at AS revision_created_at
                FROM evidence e
                LEFT JOIN LATERAL (
                    SELECT * FROM finding_revisions r
                    WHERE r.finding_id=e.id
                    ORDER BY r.revision DESC
                    LIMIT 1
                ) fr ON TRUE
                WHERE e.owner_id=? AND e.id=?
                """, ownerId, findingId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "Finding 不存在");
        var result = rows.get(0);
        enrichFinding(ownerId, result);
        return result;
    }

    public Map<String, Object> review(String ownerId, String reviewerId, String findingId,
                                      Map<String, Object> body) {
        return transactions.execute(status -> {
            var rows = jdbc.queryForList("SELECT * FROM evidence WHERE id=? AND owner_id=? FOR UPDATE",
                    findingId, ownerId);
            if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "Finding 不存在");
            var current = rows.get(0);
            var action = text(body.get("action")).toLowerCase();
            if (!Set.of("approve", "edit", "reject").contains(action)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "action 必须是 approve、edit 或 reject");
            }
            var latestRevision = latestRevision(current.get("id"));
            if (body.containsKey("expectedRevision")) {
                var expected = integer(body.get("expectedRevision"), -1);
                if (expected != latestRevision) {
                    throw new ApiException(HttpStatus.CONFLICT, "Finding revision 冲突，请刷新后重试");
                }
            }
            var theme = text(body.get("theme"));
            if (theme.isBlank()) theme = text(current.get("theme"));
            var summary = text(body.get("summary"));
            if (summary.isBlank()) summary = text(current.get("summary"));
            if (theme.isBlank() || summary.isBlank()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Finding 的 theme 和 summary 不能为空");
            }
            var severity = body.containsKey("severity")
                    ? integer(body.get("severity"), integer(current.get("severity"), 0))
                    : integer(current.get("severity"), 0);
            if (severity < 0 || severity > 5) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "severity 必须是 0-5");
            }
            var rationale = body.containsKey("rationale")
                    ? text(body.get("rationale")) : text(current.get("review_rationale"));
            var nextRevision = latestRevision + 1;
            var reviewId = id();
            var revisionId = id();
            var timestamp = now();
            var reviewStatus = switch (action) {
                case "approve" -> "approved";
                case "reject" -> "rejected";
                default -> "pending";
            };
            jdbc.update("""
                    INSERT INTO finding_revisions
                      (id,finding_id,owner_id,revision,action,status,reviewer_id,theme,summary,severity,rationale,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                    """, revisionId, findingId, ownerId, nextRevision, action, reviewStatus,
                    reviewerId, theme, summary, severity, rationale, timestamp);
            jdbc.update("""
                    INSERT INTO finding_reviews
                      (id,evidence_id,owner_id,action,reviewer_id,theme,summary,severity,rationale,created_at,revision,finding_revision_id)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                    """, reviewId, findingId, ownerId, action, reviewerId, theme, summary,
                    severity, rationale, timestamp, nextRevision, revisionId);
            // evidence is the current finding projection; the revision table is its history.
            jdbc.update("""
                    UPDATE evidence
                    SET theme=?,summary=?,severity=?,review_status=?,reviewed_by=?,reviewed_at=?,review_rationale=?
                    WHERE id=? AND owner_id=?
                    """, theme, summary, severity, reviewStatus, reviewerId, timestamp, rationale,
                    findingId, ownerId);
            jdbc.update("""
                    INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """, id(), ownerId, "finding." + action, "evidence", findingId,
                    json(mapper, Map.of("reviewerId", reviewerId, "revision", nextRevision,
                            "rationale", rationale)), timestamp);
            productEvents.track(ownerId, "finding_reviewed", text(current.get("project_id")),
                    "evidence", findingId, Map.of("action", action, "revision", nextRevision));

            var result = finding(ownerId, findingId);
            result.put("reviewId", reviewId);
            result.put("review", Map.of("id", reviewId, "revisionId", revisionId,
                    "revision", nextRevision, "action", action, "status", reviewStatus,
                    "reviewerId", reviewerId, "rationale", rationale, "createdAt", timestamp));
            return result;
        });
    }

    public List<Map<String, Object>> revisions(String ownerId, String findingId) {
        var finding = finding(ownerId, findingId);
        return jdbc.queryForList("""
                SELECT id,finding_id,owner_id,revision,action,status,reviewer_id,theme,summary,
                       severity,rationale,created_at
                FROM finding_revisions WHERE finding_id=? AND owner_id=?
                ORDER BY revision DESC
                """, finding.get("id"), ownerId);
    }

    private void enrichFinding(String ownerId, Map<String, Object> finding) {
        var revisionStatus = text(finding.get("revision_status"));
        var status = revisionStatus.isBlank() ? text(finding.get("review_status")) : revisionStatus;
        finding.put("status", status);
        finding.put("revisionId", finding.get("revision_id"));
        finding.put("revisionNumber", integer(finding.get("revision"), 1));
        finding.put("revisionStatus", status);
        finding.put("revisions", jdbc.queryForList("""
                SELECT id,finding_id,owner_id,revision,action,status,reviewer_id,theme,summary,
                       severity,rationale,created_at
                FROM finding_revisions WHERE finding_id=? AND owner_id=?
                ORDER BY revision DESC
                """, finding.get("id"), ownerId));
        finding.put("evidenceRefs", jdbc.queryForList("""
                SELECT o.id AS observation_id,o.project_id,o.workflow_run_id,o.job_id,o.record_id,
                       o.content_hash,o.change_type,o.observed_at,o.captured_at,o.source_url,
                       r.platform,r.source_item_id,r.title,r.content,r.author,r.url,l.relation
                FROM evidence_links l
                LEFT JOIN observations o ON o.record_id=l.record_id AND o.owner_id=?
                    AND o.project_id=?
                LEFT JOIN records r ON r.id=l.record_id
                WHERE l.evidence_id=?
                ORDER BY o.captured_at DESC NULLS LAST,o.id DESC
                """, ownerId, finding.get("project_id"), finding.get("id")));
    }

    private int latestRevision(Object findingId) {
        var value = jdbc.queryForObject("SELECT COALESCE(MAX(revision),0) FROM finding_revisions WHERE finding_id=?",
                Integer.class, findingId);
        return value == null ? 0 : value;
    }

    private Map<String, Object> parseMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked") var result = (Map<String, Object>) map;
            return result;
        }
        if (!(value instanceof String text) || text.isBlank()) return Map.of();
        try {
            return mapper.readValue(text, new TypeReference<Map<String, Object>>() { });
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private int bounded(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
