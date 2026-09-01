package com.threadbeacon.control.report;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.research.ResearchService;
import com.threadbeacon.control.workspace.V2Cursor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

/** Report draft/publish use cases. Published rows are snapshots, never live queries. */
@Service
public class ReportService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final ResearchService research;

    public ReportService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper mapper,
                         ResearchService research) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper;
        this.research = research;
    }

    public Map<String, Object> createDraft(String ownerId, String projectId, Map<String, Object> body) {
        var project = research.project(ownerId, projectId);
        var title = text(body.get("title"));
        if (title.isBlank()) title = text(project.get("name")) + " 研究报告";
        if (title.length() > 200) throw new ApiException(HttpStatus.BAD_REQUEST, "报告标题不能超过 200 个字符");

        var baseReportId = nullable(text(body.getOrDefault("baseReportId", body.get("reportId"))));
        if (baseReportId != null && jdbc.queryForList(
                "SELECT 1 FROM reports WHERE id=? AND owner_id=? AND project_id=?", baseReportId, ownerId, projectId).isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "基础报告不存在或不属于该项目");
        }
        var workflowRunId = nullable(text(body.get("workflowRunId")));
        if (workflowRunId != null && jdbc.queryForList(
                "SELECT 1 FROM workflow_runs WHERE id=? AND owner_id=? AND workflow_id IN (SELECT id FROM workflows WHERE project_id=?)",
                workflowRunId, ownerId, projectId).isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "运行记录不存在或不属于该项目");
        }
        var workflowVersionId = nullable(text(body.get("workflowVersionId")));
        if (workflowVersionId != null && jdbc.queryForList(
                "SELECT 1 FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE v.id=? AND v.owner_id=? AND w.project_id=?",
                workflowVersionId, ownerId, projectId).isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "工作流版本不存在或不属于该项目");
        }
        var findingIds = findingIds(body.get("findingIds"));
        if (findingIds.isEmpty()) findingIds = findingIds(body.get("findings"));
        validateFindingIds(ownerId, projectId, findingIds);

        var content = content(body.get("content"));
        if (content.isEmpty() && body.containsKey("summary")) content.put("summary", text(body.get("summary")));
        var methodKey = text(body.get("methodKey"));
        if (methodKey.isBlank()) methodKey = text(project.get("playbook_key"));
        if (methodKey.isBlank()) methodKey = "generic-research";
        var methodVersion = text(body.get("methodVersion"));
        if (methodVersion.isBlank()) methodVersion = text(project.get("playbook_version"));
        if (methodVersion.isBlank()) methodVersion = "1.0";
        var timestamp = now();
        var draftId = id();
        jdbc.update("""
                INSERT INTO report_drafts
                  (id,owner_id,project_id,base_report_id,workflow_run_id,workflow_version_id,title,
                   content_json,selected_finding_ids_json,method_key,method_version,revision,status,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,1,'draft',?,?)
                """, draftId, ownerId, projectId, baseReportId, workflowRunId, workflowVersionId, title,
                json(mapper, content), json(mapper, findingIds), methodKey, methodVersion, timestamp, timestamp);
        return draft(ownerId, draftId);
    }

    public Map<String, Object> draft(String ownerId, String draftId) {
        var rows = jdbc.queryForList("SELECT * FROM report_drafts WHERE id=? AND owner_id=?", draftId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "报告草稿不存在");
        var result = rows.get(0);
        result.put("content", parseMap(result.get("content_json")));
        result.put("findingIds", stringList(result.get("selected_finding_ids_json")));
        result.put("immutable", false);
        return result;
    }

    public Map<String, Object> publish(String ownerId, String draftId, Map<String, Object> body) {
        return transactions.execute(status -> {
            var rows = jdbc.queryForList("SELECT * FROM report_drafts WHERE id=? AND owner_id=? FOR UPDATE",
                    draftId, ownerId);
            if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "报告草稿不存在");
            var draft = rows.get(0);
            if ("published".equals(text(draft.get("status")))) {
                var existing = jdbc.queryForList("SELECT id FROM report_versions WHERE report_draft_id=? AND owner_id=? ORDER BY version DESC LIMIT 1",
                        draftId, ownerId);
                if (!existing.isEmpty()) return detail(ownerId, text(existing.get(0).get("id")));
                throw new ApiException(HttpStatus.CONFLICT, "报告草稿已发布但版本记录缺失");
            }
            if (!"draft".equals(text(draft.get("status")))) {
                throw new ApiException(HttpStatus.CONFLICT, "报告草稿当前状态不允许发布");
            }
            if (body.containsKey("expectedRevision") && integer(body.get("expectedRevision"), -1)
                    != integer(draft.get("revision"), 1)) {
                throw new ApiException(HttpStatus.CONFLICT, "报告草稿 revision 冲突，请刷新后重试");
            }

            var projectId = text(draft.get("project_id"));
            // Serialize version allocation with the project row. The unique
            // (project_id, version) constraint remains the final guard.
            jdbc.queryForList("SELECT id FROM projects WHERE id=? FOR UPDATE", projectId);
            var selected = stringList(draft.get("selected_finding_ids_json"));
            var findings = approvedFindings(ownerId, projectId, selected);
            var snapshots = new ArrayList<Map<String, Object>>();
            var evidenceComplete = true;
            for (var finding : findings) {
                var snapshot = findingSnapshot(ownerId, projectId, finding);
                snapshots.add(snapshot);
                if (!hasEvidence(ownerId, projectId, text(finding.get("id")))) evidenceComplete = false;
            }
            // An empty report is valid; it simply has no approved conclusions yet.
            if (selected.isEmpty() && findings.isEmpty()) evidenceComplete = true;
            var previous = jdbc.queryForList("SELECT version FROM report_versions WHERE project_id=? ORDER BY version DESC LIMIT 1 FOR UPDATE", projectId);
            var version = previous.isEmpty() ? 1 : integer(previous.get(0).get("version"), 0) + 1;
            var versionId = id();
            var title = text(draft.get("title"));
            var methodKey = text(draft.get("method_key"));
            var methodVersion = text(draft.get("method_version"));
            var publishedAt = now();
            var content = parseMap(draft.get("content_json"));
            content.put("title", title);
            content.put("projectId", projectId);
            content.put("method", Map.of("key", methodKey, "version", methodVersion));
            content.put("findings", snapshots);
            content.put("evidenceComplete", evidenceComplete);
            content.put("publishedAt", publishedAt);
            jdbc.update("""
                    INSERT INTO report_versions
                      (id,owner_id,project_id,report_draft_id,workflow_run_id,workflow_version_id,version,
                       title,content_json,method_key,method_version,evidence_complete,published_at,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?,?)
                    """, versionId, ownerId, projectId, draftId, nullable(text(draft.get("workflow_run_id"))),
                    nullable(text(draft.get("workflow_version_id"))), version, title, json(mapper, content), methodKey,
                    methodVersion, evidenceComplete ? 1 : 0, publishedAt, publishedAt);
            for (int position = 0; position < findings.size(); position++) {
                var finding = findings.get(position);
                var snapshot = snapshots.get(position);
                jdbc.update("""
                        INSERT INTO report_version_findings
                          (id,report_version_id,finding_id,finding_revision_id,position,theme,summary,severity,rationale,created_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?)
                        """, id(), versionId, finding.get("id"), snapshot.get("revisionId"), position,
                        snapshot.get("theme"), snapshot.get("summary"), snapshot.get("severity"),
                        snapshot.get("rationale"), publishedAt);
            }
            jdbc.update("UPDATE report_drafts SET status='published',updated_at=? WHERE id=? AND owner_id=? AND status='draft'",
                    publishedAt, draftId, ownerId);
            jdbc.update("""
                    INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """, id(), ownerId, "report.publish", "report_version", versionId,
                    json(mapper, Map.of("draftId", draftId, "version", version,
                            "approvedFindingCount", findings.size(), "evidenceComplete", evidenceComplete)), publishedAt);
            return detail(ownerId, versionId);
        });
    }

    public Map<String, Object> reports(String ownerId, String projectId) {
        return reports(ownerId, projectId, 500, "");
    }

    public Map<String, Object> reports(String ownerId, String projectId, int requestedLimit, String cursor) {
        research.project(ownerId, projectId);
        var limit = Math.max(1, Math.min(100, requestedLimit));
        var offset = V2Cursor.offset(cursor);
        var formal = jdbc.queryForList("""
                SELECT rv.*,COUNT(rvf.id) AS finding_count
                FROM report_versions rv
                LEFT JOIN report_version_findings rvf ON rvf.report_version_id=rv.id
                WHERE rv.owner_id=? AND rv.project_id=?
                GROUP BY rv.id ORDER BY rv.version DESC
                """, ownerId, projectId);
        var legacy = jdbc.queryForList("""
                SELECT r.id,r.owner_id,r.project_id,r.workflow_run_id,r.item_count,r.pain_point_count,
                       r.method_key,r.method_version,r.generated_at,r.created_at,j.platform,j.keyword
                FROM reports r JOIN jobs j ON j.id=r.job_id
                WHERE r.owner_id=? AND r.project_id=?
                ORDER BY r.created_at DESC
                """, ownerId, projectId);
        for (var row : formal) {
            row.put("formal", true);
            row.put("immutable", true);
        }
        for (var row : legacy) {
            row.put("formal", false);
            row.put("legacy", true);
            row.put("immutable", true);
        }
        var all = new ArrayList<Map<String, Object>>();
        all.addAll(formal);
        all.addAll(legacy);
        all.sort(Comparator.comparing((Map<String, Object> row) -> text(row.get("published_at")),
                Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(row -> text(row.get("created_at")), Comparator.reverseOrder()));
        var hasMore = all.size() > offset + limit;
        var page = offset >= all.size() ? List.<Map<String, Object>>of()
                : all.subList(offset, Math.min(all.size(), offset + limit));
        var result = new LinkedHashMap<String, Object>();
        result.put("reports", page);
        result.put("drafts", drafts(ownerId, projectId));
        result.put("limit", limit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + limit) : null);
        return result;
    }

    public List<Map<String, Object>> drafts(String ownerId, String projectId) {
        return jdbc.queryForList("""
                SELECT id,owner_id,project_id,base_report_id,workflow_run_id,workflow_version_id,title,
                       method_key,method_version,revision,status,created_at,updated_at
                FROM report_drafts WHERE owner_id=? AND project_id=?
                ORDER BY updated_at DESC
                """, ownerId, projectId);
    }

    public Map<String, Object> detail(String ownerId, String reportId) {
        var rows = jdbc.queryForList("SELECT * FROM report_versions WHERE id=? AND owner_id=?", reportId, ownerId);
        if (rows.isEmpty()) {
            var legacy = jdbc.queryForList("""
                    SELECT r.*,j.platform,j.keyword FROM reports r JOIN jobs j ON j.id=r.job_id
                    WHERE r.id=? AND r.owner_id=?
                    """, reportId, ownerId);
            if (legacy.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "报告不存在");
            var result = new LinkedHashMap<String, Object>(legacy.get(0));
            result.put("reportId", reportId);
            result.put("formal", false);
            result.put("legacy", true);
            result.put("immutable", true);
            result.put("findings", List.of());
            result.put("content", Map.of("legacy", true));
            return result;
        }
        var result = new LinkedHashMap<String, Object>(rows.get(0));
        var projectId = text(result.get("project_id"));
        var findings = jdbc.queryForList("""
                SELECT rvf.*,fr.revision,fr.status AS revision_status,fr.reviewer_id,
                       fr.created_at AS revision_created_at
                FROM report_version_findings rvf
                JOIN finding_revisions fr ON fr.id=rvf.finding_revision_id
                WHERE rvf.report_version_id=? ORDER BY rvf.position
                """, reportId);
        for (var finding : findings) {
            finding.put("evidenceRefs", jdbc.queryForList("""
                    SELECT o.id AS observation_id,o.project_id,o.workflow_run_id,o.job_id,o.record_id,
                           o.content_hash,o.change_type,o.observed_at,o.captured_at,o.source_url,
                           r.platform,r.source_item_id,r.title,r.content,r.author,r.url,l.relation
                    FROM evidence_links l
                    JOIN observations o ON o.record_id=l.record_id AND o.owner_id=? AND o.project_id=?
                    LEFT JOIN records r ON r.id=o.record_id
                    WHERE l.evidence_id=? ORDER BY o.captured_at DESC,o.id DESC
                    """, ownerId, projectId, finding.get("finding_id")));
        }
        result.put("reportId", reportId);
        result.put("reportVersionId", reportId);
        result.put("formal", true);
        result.put("immutable", true);
        result.put("content", parseMap(result.get("content_json")));
        result.put("findings", findings);
        result.put("evidenceComplete", integer(result.get("evidence_complete"), 0) == 1);
        return result;
    }

    private List<Map<String, Object>> approvedFindings(String ownerId, String projectId, List<String> selected) {
        var rows = new ArrayList<Map<String, Object>>();
        if (selected.isEmpty()) {
            rows.addAll(jdbc.queryForList("""
                    SELECT e.* FROM evidence e
                    WHERE e.owner_id=? AND e.project_id=?
                    ORDER BY e.created_at,e.id
                    """, ownerId, projectId));
        } else {
            for (var findingId : selected) {
                var found = jdbc.queryForList("SELECT * FROM evidence WHERE id=? AND owner_id=? AND project_id=?",
                        findingId, ownerId, projectId);
                if (!found.isEmpty()) rows.add(found.get(0));
            }
        }
        var approved = new ArrayList<Map<String, Object>>();
        for (var finding : rows) {
            // Only the current revision may enter a formal report. If a newer
            // edit is pending, an older approved revision is deliberately not
            // silently reused.
            var revisions = jdbc.queryForList("""
                    SELECT * FROM finding_revisions WHERE finding_id=? AND owner_id=?
                    ORDER BY revision DESC LIMIT 1
                    """, finding.get("id"), ownerId);
            if (revisions.isEmpty() || !"approved".equals(text(revisions.get(0).get("status")))) continue;
            var revision = revisions.get(0);
            var copy = new LinkedHashMap<String, Object>(finding);
            copy.put("revision_id", revision.get("id"));
            copy.put("revision", revision.get("revision"));
            copy.put("revision_theme", revision.get("theme"));
            copy.put("revision_summary", revision.get("summary"));
            copy.put("revision_severity", revision.get("severity"));
            copy.put("revision_rationale", revision.get("rationale"));
            approved.add(copy);
        }
        return approved;
    }

    private Map<String, Object> findingSnapshot(String ownerId, String projectId, Map<String, Object> finding) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", finding.get("id"));
        result.put("revisionId", finding.get("revision_id"));
        result.put("revision", finding.get("revision"));
        result.put("theme", finding.get("revision_theme"));
        result.put("summary", finding.get("revision_summary"));
        result.put("severity", finding.get("revision_severity"));
        result.put("rationale", finding.get("revision_rationale"));
        result.put("evidenceRefs", jdbc.queryForList("""
                SELECT o.id AS observation_id,o.content_hash,o.change_type,o.observed_at,o.captured_at,o.source_url,
                       r.id AS record_id,r.title,r.content,r.url,r.platform,r.source_item_id,l.relation
                FROM evidence_links l
                JOIN observations o ON o.record_id=l.record_id AND o.owner_id=? AND o.project_id=?
                LEFT JOIN records r ON r.id=o.record_id
                WHERE l.evidence_id=? ORDER BY o.captured_at DESC,o.id DESC
                """, ownerId, projectId, finding.get("id")));
        return result;
    }

    private boolean hasEvidence(String ownerId, String projectId, String findingId) {
        var count = jdbc.queryForObject("""
                SELECT count(*) FROM evidence_links l
                JOIN observations o ON o.record_id=l.record_id AND o.owner_id=? AND o.project_id=?
                WHERE l.evidence_id=?
                """, Integer.class, ownerId, projectId, findingId);
        return count != null && count > 0;
    }

    private void validateFindingIds(String ownerId, String projectId, List<String> ids) {
        for (var findingId : ids) {
            if (jdbc.queryForList("SELECT 1 FROM evidence WHERE id=? AND owner_id=? AND project_id=?",
                    findingId, ownerId, projectId).isEmpty()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Finding 不存在或不属于该项目：" + findingId);
            }
        }
    }

    private List<String> findingIds(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        var ids = new ArrayList<String>();
        for (var item : list) {
            if (item instanceof Map<?, ?> map) {
                var findingId = text(map.get("id"));
                if (!findingId.isBlank()) ids.add(findingId);
            } else {
                var findingId = text(item);
                if (!findingId.isBlank()) ids.add(findingId);
            }
        }
        return ids.stream().distinct().toList();
    }

    private Map<String, Object> content(Object value) {
        if (value instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked") var result = new LinkedHashMap<String, Object>((Map<String, Object>) map);
            return result;
        }
        return new LinkedHashMap<>();
    }

    private Map<String, Object> parseMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked") var result = new LinkedHashMap<String, Object>((Map<String, Object>) map);
            return result;
        }
        if (!(value instanceof String raw) || raw.isBlank()) return new LinkedHashMap<>();
        try {
            return new LinkedHashMap<>(mapper.readValue(raw, new TypeReference<Map<String, Object>>() { }));
        } catch (Exception ignored) {
            return new LinkedHashMap<>();
        }
    }

    private List<String> stringList(Object value) {
        if (value instanceof List<?> list) return list.stream().map(ReportService::asString).filter(s -> !s.isBlank()).toList();
        if (!(value instanceof String raw) || raw.isBlank()) return List.of();
        try {
            var parsed = mapper.readValue(raw, new TypeReference<List<Object>>() { });
            return parsed.stream().map(ReportService::asString).filter(s -> !s.isBlank()).toList();
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static String asString(Object value) { return value instanceof String string ? string.trim() : ""; }
    private static String nullable(String value) { return value == null || value.isBlank() ? null : value; }
}
