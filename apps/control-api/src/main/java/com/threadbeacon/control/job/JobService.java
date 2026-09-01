package com.threadbeacon.control.job;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.SecretBox;
import com.threadbeacon.control.node.WorkerNode;
import com.threadbeacon.control.platform.WorkflowRuntimeService;
import com.threadbeacon.control.platform.DeliveryService;
import com.threadbeacon.control.platform.ProductEventService;
import com.threadbeacon.control.storage.ObjectStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.*;

@Service
public class JobService {
    private static final Set<String> PLATFORMS = Set.of("geo","bluesky","reddit","youtube","twitter","tiktok","instagram","douyin","xiaohongshu","weibo","kuaishou","rss","rest","web");
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper mapper;
    private final ObjectStore objects;
    private final WorkflowRuntimeService workflowRuntime;
    private final DeliveryService deliveries;
    private final ProductEventService productEvents;
    private final SecretBox secrets;

    public JobService(JdbcTemplate jdbc, TransactionTemplate transactions, ObjectMapper mapper, ObjectStore objects,
                      WorkflowRuntimeService workflowRuntime, DeliveryService deliveries, SecretBox secrets, ProductEventService productEvents) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.mapper = mapper;
        this.objects = objects;
        this.workflowRuntime = workflowRuntime;
        this.deliveries = deliveries;
        this.secrets = secrets;
        this.productEvents = productEvents;
    }

    public Map<String, Object> create(String ownerId, Map<String, Object> input) {
        return insert(ownerId, input, null);
    }

    public Map<String, Object> insert(String ownerId, Map<String, Object> input, Map<String, Object> internalOptions) {
        var platform = text(input.get("platform"));
        var keyword = text(input.get("keyword"));
        var limit = integer(input.get("limit"), 100);
        var priority = integer(input.get("priority"), 0);
        if (!isPlatform(platform)) throw new ApiException(HttpStatus.BAD_REQUEST, "不支持的平台：" + platform);
        if (keyword.isBlank() || keyword.length() > 200) throw new ApiException(HttpStatus.BAD_REQUEST, "keyword 长度必须是 1-200 个字符");
        if (limit < 1 || limit > 1000) throw new ApiException(HttpStatus.BAD_REQUEST, "limit 必须是 1-1000");
        if (priority < -10 || priority > 10) throw new ApiException(HttpStatus.BAD_REQUEST, "priority 必须是 -10 到 10");
        Map<String, Object> options = internalOptions == null ? new LinkedHashMap<>() : new LinkedHashMap<>(internalOptions);
        var projectId = text(options.getOrDefault("projectId", input.get("projectId")));
        if (!projectId.isBlank()) {
            if (jdbc.queryForObject("SELECT count(*) FROM projects WHERE id=? AND owner_id=?", Integer.class, projectId, ownerId) != 1) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "项目不存在");
            }
            options.put("projectId", projectId);
            var project = jdbc.queryForMap("SELECT playbook_key,playbook_version FROM projects WHERE id=? AND owner_id=?", projectId, ownerId);
            options.put("playbookKey", project.get("playbook_key"));
            options.put("playbookVersion", project.get("playbook_version"));
        }
        var command = text(input.get("opencliCommand"));
        if (!command.isBlank()) {
            if (!platform.startsWith("opencli:")) throw new ApiException(HttpStatus.BAD_REQUEST, "只有 OpenCLI 平台可以指定命令");
            options.put("command", command);
            options.put("args", strings(input.get("opencliArgs")));
        }
        if (platform.equals("geo")) {
            options.put("capability", "official-site.observe@1.0.0");
            options.put("url", keyword);
            options.put("requiredArtifacts", List.of("trace"));
        }
        var jobId = id(); var timestamp = now();
        jdbc.update("""
            INSERT INTO jobs(id,owner_id,platform,keyword,source_options_json,project_id,"limit",include_comments,status,progress,priority,attempt,max_attempts,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,'queued',0,?,0,3,?,?)
            """, jobId, ownerId, platform, keyword, json(mapper, options), nullable(projectId), limit, bool(input.get("includeComments"), true) ? 1 : 0, priority, timestamp, timestamp);
        event(jobId, "queued", "任务已进入等待队列", timestamp);
        if (platform.equals("geo") && !options.containsKey("managedAcquisition")) {
            jdbc.update("""
                INSERT INTO geo_acquisition_executions(id,owner_id,request_id,idempotency_key,fingerprint,job_id,status,required_artifacts_json,geo_refs_json,created_at,updated_at)
                VALUES(?,?,?,?,?,?,'queued','["trace"]','{}',?,?)
                """, id(), ownerId, id(), "job:" + jobId, hash(keyword), jobId, timestamp, timestamp);
        }
        return get(ownerId, jobId);
    }

    public List<Map<String, Object>> list(String ownerId, int limit) {
        return jdbc.queryForList("SELECT * FROM jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT ?", ownerId, Math.max(1, Math.min(100, limit)));
    }

    public Map<String, Object> get(String ownerId, String jobId) {
        var rows = jdbc.queryForList("SELECT * FROM jobs WHERE id=? AND owner_id=?", jobId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "任务不存在");
        return rows.get(0);
    }

    public List<Map<String, Object>> events(String ownerId, String jobId, int limit) {
        return jdbc.queryForList("""
            SELECT e.* FROM job_events e JOIN jobs j ON j.id=e.job_id
            WHERE e.job_id=? AND j.owner_id=? ORDER BY e.created_at LIMIT ?
            """, jobId, ownerId, Math.max(1, Math.min(500, limit)));
    }

    public Map<String, Object> transition(String ownerId, String jobId, String action) {
        var timestamp = now();
        int changed;
        if ("cancel".equals(action)) {
            changed = jdbc.update("UPDATE jobs SET status='cancelled',assigned_node_id=NULL,finished_at=?,updated_at=? WHERE id=? AND owner_id=? AND status IN ('queued','running')", timestamp, timestamp, jobId, ownerId);
            jdbc.update("UPDATE geo_acquisition_executions SET status='cancelled',cancel_requested_at=?,finished_at=?,updated_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE job_id=?", timestamp, timestamp, timestamp, jobId);
        } else if ("retry".equals(action)) {
            changed = jdbc.update("UPDATE jobs SET status='queued',progress=0,assigned_node_id=NULL,last_error=NULL,finished_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND status IN ('failed','cancelled')", timestamp, jobId, ownerId);
            jdbc.update("UPDATE geo_acquisition_executions SET status='queued',failure_json=NULL,cancel_requested_at=NULL,finished_at=NULL,updated_at=? WHERE job_id=?", timestamp, jobId);
        } else throw new ApiException(HttpStatus.BAD_REQUEST, "action 必须是 cancel 或 retry");
        if (changed != 1) throw new ApiException(HttpStatus.CONFLICT, "当前任务状态不允许该操作");
        event(jobId, action, action.equals("cancel") ? "任务已取消" : "任务已重新进入队列", timestamp);
        return get(ownerId, jobId);
    }

    public Map<String, Object> claim(WorkerNode node) {
        if (node.activeJobs() >= node.maxConcurrency()) return null;
        return transactions.execute(status -> {
            var timestamp = now();
            var stale = Instant.now().minus(60, ChronoUnit.SECONDS).toString();
            jdbc.update("""
                UPDATE jobs SET status='queued',assigned_node_id=NULL,started_at=NULL,updated_at=?,last_error='Worker 租约过期，已重新排队'
                WHERE status='running' AND updated_at<? AND attempt<max_attempts
                """, timestamp, stale);
            var candidates = jdbc.queryForList("""
                SELECT id,platform,keyword,source_options_json,"limit",include_comments,attempt
                FROM jobs WHERE status='queued' ORDER BY priority DESC,created_at FOR UPDATE SKIP LOCKED LIMIT 100
                """);
            var selected = candidates.stream().filter(job -> node.capabilities().contains(text(job.get("platform")))).findFirst().orElse(null);
            if (selected == null) return null;
            var jobId = text(selected.get("id"));
            var changed = jdbc.update("""
                UPDATE jobs SET status='running',assigned_node_id=?,attempt=attempt+1,progress=5,started_at=COALESCE(started_at,?),updated_at=?
                WHERE id=? AND status='queued'
                """, node.id(), timestamp, timestamp, jobId);
            if (changed != 1) throw new ApiException(HttpStatus.CONFLICT, "任务已被其他 Worker 获取");
            event(jobId, "running", "Worker " + node.id() + " 已获取任务", timestamp);
            jdbc.update("UPDATE workflow_run_jobs SET status='running',updated_at=? WHERE job_id=?", timestamp, jobId);
            jdbc.update("UPDATE workflow_checkpoints SET status='running',started_at=COALESCE(started_at,?),attempt=attempt+1,updated_at=? WHERE run_id=(SELECT run_id FROM workflow_run_jobs WHERE job_id=?) AND node_id=(SELECT source_node_id FROM workflow_run_jobs WHERE job_id=?)", timestamp, timestamp, jobId, jobId);
            jdbc.update("UPDATE workflow_runs SET status='running',updated_at=? WHERE id=(SELECT run_id FROM workflow_run_jobs WHERE job_id=?) AND status='queued'", timestamp, jobId);
            if ("geo".equals(text(selected.get("platform")))) {
                jdbc.update("""
                    UPDATE geo_acquisition_executions SET status='running',attempt=attempt+1,lease_owner=?,lease_token=?,heartbeat_at=?,lease_expires_at=?,started_at=COALESCE(started_at,?),updated_at=?
                    WHERE job_id=? AND status IN ('accepted','queued','running')
                    """, node.id(), id(), timestamp, Instant.now().plus(30, ChronoUnit.SECONDS).toString(), timestamp, timestamp, jobId);
            }
            var result = new LinkedHashMap<>(selected);
            var options = new LinkedHashMap<>(object(parse(mapper, selected.get("source_options_json"), Map.of())));
            if ("fetchOwned".equals(text(options.get("mode")))) {
                var encrypted = text(options.remove("grantHandleEncrypted"));
                if (encrypted.isBlank()) throw new ApiException(HttpStatus.CONFLICT, "自有账号任务缺少加密授权句柄");
                options.put("grantHandle", secrets.decrypt(encrypted));
                result.put("source_options_json", json(mapper, options));
            }
            result.put("attempt", integer(selected.get("attempt"), 0) + 1);
            return result;
        });
    }

    public Map<String, Object> complete(WorkerNode node, String jobId, Map<String, Object> report) {
        var objectKey = "reports/" + jobId + ".json";
        try { objects.putJson(objectKey, mapper.writeValueAsBytes(report)); }
        catch (Exception error) { throw new ApiException(HttpStatus.BAD_GATEWAY, "报告写入对象存储失败"); }
        try {
            var completed = transactions.execute(status -> completeTransaction(node, jobId, report, objectKey));
            if (completed == null) throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "任务完成事务没有返回结果");
            deliveries.deliver(text(completed.get("owner_id")), jobId, Map.of(
                    "platform", completed.get("platform"), "keyword", completed.get("keyword"),
                    "itemCount", completed.get("item_count"), "painPointCount", completed.get("pain_point_count"),
                    "reportId", completed.get("id")));
            return completed;
        } catch (RuntimeException error) {
            try { objects.remove(objectKey); } catch (Exception ignored) {}
            throw error;
        }
    }

    private Map<String, Object> completeTransaction(WorkerNode node, String jobId, Map<String, Object> report, String objectKey) {
        var jobs = jdbc.queryForList("""
            SELECT j.owner_id,j.platform,j.keyword,j.attempt,j.source_options_json,j.project_id,j.workflow_run_id,
                   COALESCE(p.playbook_key,'generic-research') AS playbook_key,
                   COALESCE(p.playbook_version,'1.0') AS playbook_version
            FROM jobs j LEFT JOIN projects p ON p.id=j.project_id
            WHERE j.id=? AND j.assigned_node_id=? AND j.status='running' FOR UPDATE OF j
            """, jobId, node.id());
        if (jobs.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "任务租约已经失效");
        var job = jobs.get(0); var ownerId = text(job.get("owner_id")); var platform = text(job.get("platform"));
        var projectId = text(job.get("project_id")); var workflowRunId = text(job.get("workflow_run_id")); var timestamp = now();
        var items = array(report.get("items")); var painPoints = array(report.get("painPoints")); var reportId = id();
        var recordIds = new ArrayList<String>();
        for (var value : items) recordIds.add(persistRecord(ownerId, platform, projectId, workflowRunId, jobId, timestamp, object(value)));
        var observationCounts = observationCounts(jobId);
        jdbc.update("""
            INSERT INTO reports(id,job_id,owner_id,project_id,workflow_run_id,object_key,item_count,pain_point_count,method_key,method_version,observation_count,baseline_count,new_count,changed_count,unchanged_count,generated_at,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET project_id=excluded.project_id,workflow_run_id=excluded.workflow_run_id,object_key=excluded.object_key,item_count=excluded.item_count,pain_point_count=excluded.pain_point_count,method_key=excluded.method_key,method_version=excluded.method_version,observation_count=excluded.observation_count,baseline_count=excluded.baseline_count,new_count=excluded.new_count,changed_count=excluded.changed_count,unchanged_count=excluded.unchanged_count,generated_at=excluded.generated_at
            """, reportId, jobId, ownerId, nullable(projectId), nullable(workflowRunId), objectKey, items.size(), painPoints.size(),
                text(job.get("playbook_key")), text(job.get("playbook_version")), items.size(), observationCounts.get("baseline"), observationCounts.get("new"), observationCounts.get("changed"), observationCounts.get("unchanged"), timestamp, timestamp);
        reportId = text(jdbc.queryForMap("SELECT id FROM reports WHERE job_id=?", jobId).get("id"));
        var summary = items.size() + " 条数据，" + painPoints.size() + " 个候选发现";
        var changed = jdbc.update("UPDATE jobs SET status='completed',progress=100,result_summary=?,last_error=NULL,finished_at=?,updated_at=? WHERE id=? AND assigned_node_id=? AND status='running'", summary, timestamp, timestamp, jobId, node.id());
        if (changed != 1) throw new ApiException(HttpStatus.CONFLICT, "任务租约已经失效");
        event(jobId, "completed", summary, timestamp);
        completeWorkflowSource(jobId, report, timestamp);
        var candidateCount = persistEvidence(ownerId, projectId, workflowRunId, jobId, reportId, painPoints, recordIds, timestamp, text(job.get("playbook_key")), observationCounts);
        jdbc.update("UPDATE reports SET pain_point_count=? WHERE id=?", candidateCount, reportId);
        if (!projectId.isBlank() && observationCounts.getOrDefault("baseline", 0) > 0) {
            productEvents.track(ownerId, "baseline_completed", projectId, "report", reportId, Map.of("observationCount", items.size()));
        }
        var options = object(parse(mapper, job.get("source_options_json"), Map.of()));
        var projectSourceId = text(options.get("sourceId"));
        if (bool(options.get("sourceTest"), false) && !projectSourceId.isBlank()) {
            jdbc.update("UPDATE project_sources SET status='active',updated_at=? WHERE id=? AND owner_id=?", timestamp, projectSourceId, ownerId);
            jdbc.update("UPDATE project_source_cursors SET cursor_json=?,last_success_at=?,last_job_id=?,consecutive_failures=0,last_error=NULL,updated_at=? WHERE source_id=? AND owner_id=?",
                    json(mapper, object(report.get("sourceCursor"))), timestamp, jobId, timestamp, projectSourceId, ownerId);
            productEvents.track(ownerId, "source_ready", projectId, "project_source", projectSourceId, Map.of("jobId", jobId));
        }
        if (platform.equals("geo")) {
            var geo = object(report.get("geoAcquisition"));
            var trace = report.get("geoTrace");
            jdbc.update("""
                UPDATE geo_acquisition_executions SET status='succeeded',result_json=?,trace_ref=?,artifact_refs_json=?,finished_at=?,updated_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL
                WHERE job_id=? AND lease_owner=? AND status='running'
                """, json(mapper, geo.isEmpty() ? report : geo), "s3://" + objectKey + "#geoTrace", json(mapper, trace == null ? List.of() : List.of(Map.of("kind", "trace", "ref", "s3://" + objectKey + "#geoTrace"))), timestamp, timestamp, jobId, node.id());
        }
         var completed=new LinkedHashMap<String,Object>();completed.put("id",reportId);completed.put("job_id",jobId);completed.put("owner_id",ownerId);completed.put("project_id",nullable(projectId));completed.put("workflow_run_id",nullable(workflowRunId));completed.put("object_key",objectKey);completed.put("item_count",items.size());completed.put("pain_point_count",candidateCount);completed.put("method_key",text(job.get("playbook_key")));completed.put("method_version",text(job.get("playbook_version")));completed.put("observation_count",items.size());completed.put("baseline_count",observationCounts.get("baseline"));completed.put("new_count",observationCounts.get("new"));completed.put("changed_count",observationCounts.get("changed"));completed.put("unchanged_count",observationCounts.get("unchanged"));completed.put("generated_at",timestamp);completed.put("platform",platform);completed.put("keyword",text(job.get("keyword")));return completed;
    }

    public Map<String, Object> fail(WorkerNode node, String jobId, String message) {
        return transactions.execute(status -> {
            var jobs = jdbc.queryForList("SELECT owner_id,attempt,max_attempts,platform,source_options_json FROM jobs WHERE id=? AND assigned_node_id=? AND status='running' FOR UPDATE", jobId, node.id());
            if (jobs.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "任务租约已经失效");
            var job = jobs.get(0); var attempt = integer(job.get("attempt"), 0); var maxAttempts = integer(job.get("max_attempts"), 3);
            var next = attempt >= maxAttempts ? "failed" : "queued"; var timestamp = now();
            jdbc.update("""
                UPDATE jobs SET status=?,progress=0,last_error=?,assigned_node_id=NULL,finished_at=CASE WHEN ?='failed' THEN ? ELSE NULL END,updated_at=? WHERE id=? AND assigned_node_id=?
                """, next, message, next, timestamp, timestamp, jobId, node.id());
            event(jobId, next, message, timestamp);
            if (next.equals("queued")) {
                jdbc.update("UPDATE workflow_run_jobs SET status='queued',updated_at=? WHERE job_id=?", timestamp, jobId);
            } else {
                jdbc.update("UPDATE workflow_run_jobs SET status='failed',result_json=?,updated_at=? WHERE job_id=?", json(mapper, Map.of("error", message)), timestamp, jobId);
                jdbc.update("UPDATE workflow_checkpoints SET status='failed',output_json=?,finished_at=?,updated_at=? WHERE run_id=(SELECT run_id FROM workflow_run_jobs WHERE job_id=?) AND node_id=(SELECT source_node_id FROM workflow_run_jobs WHERE job_id=?)", json(mapper, Map.of("error", message)), timestamp, timestamp, jobId, jobId);
                jdbc.update("UPDATE workflow_runs SET status='failed',last_error=?,finished_at=?,updated_at=? WHERE id=(SELECT run_id FROM workflow_run_jobs WHERE job_id=?)", message, timestamp, timestamp, jobId);
            }
            var options = object(parse(mapper, job.get("source_options_json"), Map.of()));
            var projectSourceId = text(options.get("sourceId"));
            if (next.equals("failed") && bool(options.get("sourceTest"), false) && !projectSourceId.isBlank()) {
                jdbc.update("UPDATE project_sources SET status='error',updated_at=? WHERE id=? AND owner_id=?", timestamp, projectSourceId, text(job.get("owner_id")));
                jdbc.update("UPDATE project_source_cursors SET consecutive_failures=consecutive_failures+1,last_error=?,updated_at=? WHERE source_id=? AND owner_id=?",
                        message, timestamp, projectSourceId, text(job.get("owner_id")));
            }
            if ("geo".equals(text(job.get("platform")))) {
                jdbc.update("""
                    UPDATE geo_acquisition_executions SET status=?,failure_json=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
                    finished_at=CASE WHEN ?='failed' THEN ? ELSE NULL END,updated_at=? WHERE job_id=?
                    """, next, json(mapper, Map.of("message", message, "retryable", next.equals("queued"))), next, timestamp, timestamp, jobId);
            }
            return Map.of("id", jobId, "status", next, "attempt", attempt, "max_attempts", maxAttempts, "last_error", message);
        });
    }

    public List<Map<String, Object>> records(String ownerId, String search, String platform, int limit, int offset) {
        return jdbc.queryForList("""
            SELECT * FROM records WHERE owner_id=? AND (?='' OR platform=?)
            AND (?='' OR content ILIKE '%'||?||'%' OR COALESCE(title,'') ILIKE '%'||?||'%')
            ORDER BY last_seen_at DESC LIMIT ? OFFSET ?
            """, ownerId, platform, platform, search, search, search, Math.max(1, Math.min(500, limit)), Math.max(0, offset));
    }

    public int recordCount(String ownerId, String search, String platform) {
        return jdbc.queryForObject("""
            SELECT count(*) FROM records WHERE owner_id=? AND (?='' OR platform=?)
            AND (?='' OR content ILIKE '%'||?||'%' OR COALESCE(title,'') ILIKE '%'||?||'%')
            """, Integer.class, ownerId, platform, platform, search, search, search);
    }

    public List<Map<String, Object>> exportRecords(String ownerId, String search, String platform) {
        return jdbc.queryForList("""
            SELECT id,platform,source_item_id,item_type,title,content,author,url,observed_at,duplicate_count
            FROM records WHERE owner_id=? AND (?='' OR platform=?)
            AND (?='' OR content ILIKE '%'||?||'%' OR COALESCE(title,'') ILIKE '%'||?||'%')
            ORDER BY last_seen_at DESC
            """, ownerId, platform, platform, search, search, search);
    }

    public Map<String, Object> reportMeta(String ownerId, String reportId) {
        var rows = jdbc.queryForList("SELECT * FROM reports WHERE id=? AND owner_id=?", reportId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "报告不存在");
        return rows.get(0);
    }

    public Map<String, Object> report(String ownerId, String reportId) {
        var meta = reportMeta(ownerId, reportId);
        try (var input = objects.get(text(meta.get("object_key")))) {
            var result = mapper.readValue(input, new TypeReference<Map<String, Object>>() {});
            var findings = jdbc.queryForList("""
                SELECT e.*,COALESCE((SELECT count(*) FROM evidence_links l WHERE l.evidence_id=e.id),0) AS linked_count
                FROM evidence e WHERE e.owner_id=? AND e.report_id=? AND e.review_status='approved'
                ORDER BY e.created_at
                """, ownerId, reportId);
            var jobId = text(meta.get("job_id"));
            for (var finding : findings) {
                finding.put("evidenceRefs", jdbc.queryForList("""
                    SELECT o.id AS observation_id,o.content_hash,o.observed_at,o.captured_at,o.source_url,
                           r.id AS record_id,r.title,r.content,r.url
                    FROM evidence_links l
                    JOIN observations o ON o.record_id=l.record_id AND o.job_id=?
                    JOIN records r ON r.id=o.record_id
                    WHERE l.evidence_id=? ORDER BY o.captured_at
                    """, jobId, finding.get("id")));
            }
            var candidates = jdbc.queryForObject("SELECT count(*) FROM evidence WHERE owner_id=? AND report_id=?", Integer.class, ownerId, reportId);
            result.remove("painPoints");
            result.put("findings", findings);
            result.put("candidateFindingCount", candidates == null ? 0 : candidates);
            var candidateCount = candidates == null ? 0 : candidates;
            result.put("reviewStatus", candidateCount == 0 ? "empty" : findings.isEmpty() ? "pending_review" : "approved");
            result.put("reportId", reportId);
            result.put("projectId", meta.get("project_id"));
            result.put("workflowRunId", meta.get("workflow_run_id"));
            result.put("method", Map.of("key", text(meta.get("method_key")), "version", text(meta.get("method_version"))));
            result.put("observationSummary", Map.of(
                    "total", integer(meta.get("observation_count"), 0),
                    "baseline", integer(meta.get("baseline_count"), 0),
                    "new", integer(meta.get("new_count"), 0),
                    "changed", integer(meta.get("changed_count"), 0),
                    "unchanged", integer(meta.get("unchanged_count"), 0)));
            var sourceCount = jdbc.queryForObject("SELECT count(DISTINCT platform) FROM observations WHERE job_id=?", Integer.class, jobId);
            var citationCount = findings.stream().mapToInt(finding -> ((List<?>) finding.getOrDefault("evidenceRefs", List.of())).size()).sum();
            result.put("analysisMode", "competitive-research".equals(text(meta.get("method_key")))
                    ? (integer(meta.get("baseline_count"), 0) > 0 ? "baseline" : "delta")
                    : "snapshot");
            result.put("quality", Map.of(
                    "dataQuality", String.valueOf(result.getOrDefault("dataQuality", "unknown")),
                    "sourceCount", sourceCount == null ? 0 : sourceCount,
                    "candidateFindingCount", candidateCount,
                    "approvedFindingCount", findings.size(),
                    "citationCount", citationCount));
            return result;
        } catch (ApiException error) {
            throw error;
        } catch (Exception error) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "报告读取失败");
        }
    }

    public List<Map<String, Object>> findings(String ownerId, String projectId) {
        var filter = projectId == null ? "" : projectId.trim();
        return jdbc.queryForList("""
            SELECT e.*,COALESCE((SELECT count(*) FROM evidence_links l WHERE l.evidence_id=e.id),0) AS linked_count
            FROM evidence e WHERE e.owner_id=? AND (?='' OR e.project_id=?)
            ORDER BY e.created_at DESC LIMIT 500
            """, ownerId, filter, filter);
    }

    public List<Map<String, Object>> observations(String ownerId, String projectId, int limit) {
        var filter = projectId == null ? "" : projectId.trim();
        return jdbc.queryForList("""
            SELECT o.id,o.project_id,o.workflow_run_id,o.job_id,o.record_id,o.platform,o.source_item_id,
                   o.content_hash,o.change_type,o.observed_at,o.captured_at,o.source_url,r.title,r.url
            FROM observations o JOIN records r ON r.id=o.record_id
            WHERE o.owner_id=? AND (?='' OR o.project_id=?)
            ORDER BY o.captured_at DESC LIMIT ?
            """, ownerId, filter, filter, Math.max(1, Math.min(500, limit)));
    }

    public Map<String, Object> reviewFinding(String ownerId, String reviewerId, String findingId, Map<String, Object> body) {
        return transactions.execute(status -> {
            var rows = jdbc.queryForList("SELECT * FROM evidence WHERE id=? AND owner_id=? FOR UPDATE", findingId, ownerId);
            if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "Finding 不存在");
            var action = text(body.get("action"));
            if (!Set.of("approve", "edit", "reject").contains(action)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "action 必须是 approve、edit 或 reject");
            }
            var current = rows.get(0);
            var theme = text(body.get("theme"));
            if (theme.isBlank()) theme = text(current.get("theme"));
            var summary = text(body.get("summary"));
            if (summary.isBlank()) summary = text(current.get("summary"));
            var severity = body.containsKey("severity") ? integer(body.get("severity"), integer(current.get("severity"), 0)) : integer(current.get("severity"), 0);
            severity = Math.max(0, Math.min(5, severity));
            var rationale = text(body.get("rationale"));
            var timestamp = now();
            var reviewStatus = switch (action) {
                case "approve" -> "approved";
                case "reject" -> "rejected";
                default -> "pending";
            };
            jdbc.update("""
                UPDATE evidence SET theme=?,summary=?,severity=?,review_status=?,reviewed_by=?,reviewed_at=?,review_rationale=?
                WHERE id=? AND owner_id=?
                """, theme, summary, severity, reviewStatus, reviewerId, timestamp, rationale, findingId, ownerId);
            jdbc.update("""
                INSERT INTO finding_reviews(id,evidence_id,owner_id,action,reviewer_id,theme,summary,severity,rationale,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                """, id(), findingId, ownerId, action, reviewerId, theme, summary, severity, rationale, timestamp);
            jdbc.update("INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",
                    id(), ownerId, "finding." + action, "evidence", findingId,
                    json(mapper, Map.of("reviewerId", reviewerId, "rationale", rationale)), timestamp);
            productEvents.track(ownerId, "finding_reviewed", text(current.get("project_id")), "evidence", findingId, Map.of("action", action));
            return jdbc.queryForMap("""
                SELECT e.*,COALESCE((SELECT count(*) FROM evidence_links l WHERE l.evidence_id=e.id),0) AS linked_count
                FROM evidence e WHERE e.id=? AND e.owner_id=?
                """, findingId, ownerId);
        });
    }

    private String persistRecord(String ownerId, String platform, String projectId, String workflowRunId, String jobId, String timestamp, Map<String, Object> item) {
        var sourceId = text(item.get("id"));
        if (sourceId.isBlank()) sourceId = hash(text(item.get("text")) + "\n" + text(item.get("postedAt")));
        var content = text(item.get("text"));
        if (content.isBlank()) content = text(item.get("content"));
        var observed = text(item.get("postedAt")); if (observed.isBlank()) observed = timestamp;
        var rawJson = json(mapper, item);
        var contentHash = hash(rawJson);
        var previous = projectId.isBlank()
                ? jdbc.queryForList("SELECT content_hash FROM observations WHERE owner_id=? AND platform=? AND source_item_id=? ORDER BY captured_at DESC LIMIT 1", ownerId, platform, sourceId)
                : jdbc.queryForList("SELECT content_hash FROM observations WHERE owner_id=? AND project_id=? AND platform=? AND source_item_id=? ORDER BY captured_at DESC LIMIT 1", ownerId, projectId, platform, sourceId);
        var priorRows = projectId.isBlank()
                ? jdbc.queryForList("SELECT 1 FROM observations WHERE owner_id=? AND platform=? AND job_id<>? LIMIT 1", ownerId, platform, jobId)
                : jdbc.queryForList("SELECT 1 FROM observations WHERE owner_id=? AND project_id=? AND job_id<>? LIMIT 1", ownerId, projectId, jobId);
        var changeType = priorRows.isEmpty() ? "baseline" : previous.isEmpty() ? "new" : contentHash.equals(text(previous.get(0).get("content_hash"))) ? "unchanged" : "changed";
        var recordId=id();jdbc.update("""
            INSERT INTO records(id,owner_id,platform,source_item_id,item_type,title,content,author,url,observed_at,metrics_json,raw_json,first_seen_job_id,last_seen_job_id,first_seen_at,last_seen_at,duplicate_count)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
            ON CONFLICT(owner_id,platform,source_item_id) DO UPDATE SET title=excluded.title,content=excluded.content,author=excluded.author,url=excluded.url,
            observed_at=excluded.observed_at,metrics_json=excluded.metrics_json,raw_json=excluded.raw_json,last_seen_job_id=excluded.last_seen_job_id,last_seen_at=excluded.last_seen_at,duplicate_count=records.duplicate_count+1
            """, recordId, ownerId, platform, sourceId, text(item.get("itemType")).isBlank() ? "post" : text(item.get("itemType")),
                nullable(item.get("title")), content, nullable(item.get("author")), nullable(item.get("url")), observed,
                json(mapper, item.getOrDefault("metrics", Map.of())), json(mapper, item.getOrDefault("raw", item)), jobId, jobId, timestamp, timestamp);
        var persistedId = text(jdbc.queryForMap("SELECT id FROM records WHERE owner_id=? AND platform=? AND source_item_id=?",ownerId,platform,sourceId).get("id"));
        jdbc.update("""
            INSERT INTO observations(id,owner_id,project_id,workflow_run_id,job_id,record_id,platform,source_item_id,content_hash,change_type,observed_at,captured_at,source_url,payload_json,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(job_id,record_id) DO NOTHING
            """, id(), ownerId, nullable(projectId), nullable(workflowRunId), jobId, persistedId, platform, sourceId,
                contentHash, changeType, observed, timestamp, nullable(item.get("url")), rawJson, timestamp);
        return persistedId;
    }

    private Map<String, Integer> observationCounts(String jobId) {
        var result = new LinkedHashMap<String, Integer>();
        result.put("baseline", 0); result.put("new", 0); result.put("changed", 0); result.put("unchanged", 0);
        for (var row : jdbc.queryForList("SELECT change_type,count(*) AS count FROM observations WHERE job_id=? GROUP BY change_type", jobId)) {
            result.put(text(row.get("change_type")), integer(row.get("count"), 0));
        }
        return result;
    }

    private int persistEvidence(String ownerId,String projectId,String workflowRunId,String jobId,String reportId,List<Object> painPoints,List<String> recordIds,String timestamp,String methodKey,Map<String,Integer> observationCounts){
        var changeTypes = new HashMap<String, String>();
        for (var row : jdbc.queryForList("SELECT record_id,change_type FROM observations WHERE job_id=?", jobId)) changeTypes.put(text(row.get("record_id")), text(row.get("change_type")));
        var candidateCount = 0;
        for(var value:painPoints){
            var point=object(value);var evidenceId=id();var members=array(point.get("memberIndices"));
            var linked=new ArrayList<String>();
            var hasDelta = false;
            for(var indexValue:members){var index=integer(indexValue,-1);if(index>=0&&index<recordIds.size()&&!linked.contains(recordIds.get(index))){var recordId=recordIds.get(index);linked.add(recordId);var type=changeTypes.get(recordId);hasDelta=hasDelta||"new".equals(type)||"changed".equals(type);}}
            if (linked.isEmpty() || ("competitive-research".equals(methodKey) && observationCounts.getOrDefault("baseline", 0) == 0 && !hasDelta)) continue;
            jdbc.update("INSERT INTO evidence(id,owner_id,project_id,workflow_run_id,job_id,report_id,theme,summary,severity,source_count,uncertainties_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",evidenceId,ownerId,nullable(projectId),nullable(workflowRunId),jobId,reportId,text(point.get("theme")),text(point.get("summary")),Math.max(0,Math.min(5,integer(point.get("severity"),0))),linked.size(),json(mapper, point.getOrDefault("uncertainties", List.of())),timestamp);
            for (var recordId : linked) jdbc.update("INSERT INTO evidence_links(id,evidence_id,record_id,relation,created_at) VALUES(?,?,?,'supports',?) ON CONFLICT(evidence_id,record_id) DO NOTHING",id(),evidenceId,recordId,timestamp);
            for(int left=0;left<linked.size()&&left<20;left++)for(int right=left+1;right<linked.size()&&right<20;right++)jdbc.update("INSERT INTO record_relationships(id,owner_id,project_id,source_record_id,target_record_id,relation,confidence,created_at) VALUES(?,?,?,?,?,'co-supports',80,?) ON CONFLICT(source_record_id,target_record_id,relation) DO NOTHING",id(),ownerId,nullable(projectId),linked.get(left),linked.get(right),timestamp);
            candidateCount++;
        }
        return candidateCount;
    }

    private Object nullable(Object value) { var text = text(value); return text.isBlank() ? null : text; }
    private void completeWorkflowSource(String jobId, Map<String,Object> report, String timestamp) {
        var links = jdbc.queryForList("SELECT run_id,source_node_id FROM workflow_run_jobs WHERE job_id=?", jobId);
        if (links.isEmpty()) return;
        var link = links.get(0); var runId = text(link.get("run_id")); var sourceNodeId = text(link.get("source_node_id"));
        var compact = json(mapper, report); if (compact.length() > 500_000) compact = json(mapper, Map.of("truncated", true, "jobId", jobId));
        jdbc.update("UPDATE workflow_run_jobs SET status='completed',result_json=?,updated_at=? WHERE job_id=?", compact, timestamp, jobId);
        jdbc.update("UPDATE workflow_checkpoints SET status='completed',output_json=?,finished_at=?,updated_at=? WHERE run_id=? AND node_id=?", compact, timestamp, timestamp, runId, sourceNodeId);
        var remaining = jdbc.queryForObject("SELECT count(*) FROM workflow_run_jobs WHERE run_id=? AND status<>'completed'", Integer.class, runId);
        if (remaining != null && remaining == 0) {
            jdbc.update("UPDATE workflow_runs SET status='finalizing',updated_at=? WHERE id=? AND status IN ('queued','running','finalizing')", timestamp, runId);
            jdbc.update("INSERT INTO workflow_events(id,run_id,node_id,type,message,payload_json,created_at) VALUES(?,?,?,'finalizing','所有来源任务完成，开始推进 DAG','{}',?)", id(), runId, "runtime", timestamp);
            workflowRuntime.sourcesReady(runId);
        }
    }
    private void event(String jobId, String type, String message, String timestamp) { jdbc.update("INSERT INTO job_events(id,job_id,type,message,created_at) VALUES(?,?,?,?,?)", id(), jobId, type, message.substring(0, Math.min(2000, message.length())), timestamp); }
    private boolean isPlatform(String value) { return PLATFORMS.contains(value) || value.matches("opencli:[a-z0-9][a-z0-9._-]{0,63}"); }
}
