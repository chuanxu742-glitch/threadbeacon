package com.threadbeacon.control.delivery;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.SecretBox;
import com.threadbeacon.control.workspace.V2Cursor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.json;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

/**
 * Delivery business intent and its technical attempts. An idempotency key always
 * identifies the operation; retries only append attempts to that operation.
 */
@Service
public class DeliveryApplicationService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final SecretBox secrets;
    private final ObjectMapper mapper;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public DeliveryApplicationService(JdbcTemplate jdbc, TransactionTemplate transactions, SecretBox secrets,
                                      ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.transactions = transactions;
        this.secrets = secrets;
        this.mapper = mapper;
    }

    public Map<String, Object> create(String ownerId, String reportId, Map<String, Object> body,
                                      String requestedIdempotencyKey) {
        var report = report(ownerId, reportId);
        var projectId = text(report.get("project_id"));
        var rule = rule(ownerId, projectId, text(body.get("ruleId")));
        var key = text(requestedIdempotencyKey);
        if (key.isBlank()) key = text(body.get("idempotencyKey"));
        if (key.isBlank()) key = "v2:report:" + reportId + ":rule:" + text(rule.get("id"));
        if (key.length() > 200) throw new ApiException(HttpStatus.BAD_REQUEST, "Idempotency-Key 不能超过 200 个字符");
        final var idempotencyKey = key;

        var existing = jdbc.queryForList("SELECT id,report_version_id,rule_id FROM delivery_operations WHERE owner_id=? AND idempotency_key=?",
                ownerId, idempotencyKey);
        if (!existing.isEmpty()) {
            var operation = existing.get(0);
            if (!reportId.equals(text(operation.get("report_version_id")))
                    || !text(rule.get("id")).equals(text(operation.get("rule_id")))) {
                throw new ApiException(HttpStatus.CONFLICT, "Idempotency-Key 已用于其他交付意图");
            }
            if (Boolean.TRUE.equals(body.get("retry"))) return retry(ownerId, text(operation.get("id")));
            return detail(ownerId, text(operation.get("id")));
        }

        var operationId = id();
        var attemptId = id();
        var timestamp = now();
        var destination = Map.of("ruleId", text(rule.get("id")), "kind", text(rule.get("kind")));
        var inserted = transactions.execute(status -> {
            var changed = jdbc.update("""
                    INSERT INTO delivery_operations
                      (id,owner_id,project_id,report_version_id,rule_id,idempotency_key,kind,destination_json,
                       status,technical_status,business_outcome_status,business_outcome_json,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?, 'queued','pending','pending','{}',?,?)
                    ON CONFLICT(owner_id,idempotency_key) DO NOTHING
                    """, operationId, ownerId, projectId, reportId, rule.get("id"), idempotencyKey, rule.get("kind"),
                    json(mapper, destination), timestamp, timestamp);
            if (changed == 0) return 0;
            jdbc.update("""
                    INSERT INTO delivery_attempts
                      (id,operation_id,attempt,status,execution_result_json,created_at)
                    VALUES(?,?,1,'queued','{}',?)
                    """, attemptId, operationId, timestamp);
            audit(ownerId, "delivery.create", "delivery_operation", operationId,
                    Map.of("reportVersionId", reportId, "ruleId", rule.get("id"), "idempotencyKey", idempotencyKey), timestamp);
            return 1;
        });
        if (inserted == null || inserted == 0) {
            var winner = jdbc.queryForMap("SELECT id,report_version_id,rule_id FROM delivery_operations WHERE owner_id=? AND idempotency_key=?",
                    ownerId, idempotencyKey);
            if (!reportId.equals(text(winner.get("report_version_id")))
                    || !text(rule.get("id")).equals(text(winner.get("rule_id")))) {
                throw new ApiException(HttpStatus.CONFLICT, "Idempotency-Key 已用于其他交付意图");
            }
            return detail(ownerId, text(winner.get("id")));
        }
        if (!Boolean.FALSE.equals(body.get("execute"))) executeAttempt(ownerId, operationId, attemptId, 1, report, rule);
        return detail(ownerId, operationId);
    }

    public Map<String, Object> retry(String ownerId, String operationId) {
        var created = transactions.execute(status -> {
            var operations = jdbc.queryForList("SELECT * FROM delivery_operations WHERE id=? AND owner_id=? FOR UPDATE",
                    operationId, ownerId);
            if (operations.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "交付操作不存在");
            var operation = operations.get(0);
            var operationStatus = text(operation.get("status"));
            if (!Set.of("failed", "unknown", "submitted").contains(operationStatus)) {
                throw new ApiException(HttpStatus.CONFLICT, "当前交付状态不允许重试");
            }
            var currentAttempt = jdbc.queryForObject("SELECT COALESCE(MAX(attempt),0) FROM delivery_attempts WHERE operation_id=?",
                    Integer.class, operationId);
            var attempt = (currentAttempt == null ? 0 : currentAttempt) + 1;
            if (attempt > 20) throw new ApiException(HttpStatus.CONFLICT, "交付重试次数已达上限");
            var attemptId = id();
            var timestamp = now();
            jdbc.update("UPDATE delivery_operations SET status='queued',technical_status='pending',business_outcome_status='pending',updated_at=? WHERE id=? AND owner_id=?",
                    timestamp, operationId, ownerId);
            jdbc.update("INSERT INTO delivery_attempts(id,operation_id,attempt,status,execution_result_json,created_at) VALUES(?,?,?,'queued','{}',?)",
                    attemptId, operationId, attempt, timestamp);
            return Map.of("operation", operation, "attemptId", attemptId, "attempt", attempt);
        });
        var operation = jdbc.queryForMap("SELECT * FROM delivery_operations WHERE id=? AND owner_id=?", operationId, ownerId);
        var report = report(ownerId, text(operation.get("report_version_id")));
        var rule = rule(ownerId, text(operation.get("project_id")), text(operation.get("rule_id")));
        executeAttempt(ownerId, operationId, text(created.get("attemptId")), integer(created.get("attempt"), 1), report, rule);
        return detail(ownerId, operationId);
    }

    public List<Map<String, Object>> projectDeliveries(String ownerId, String projectId, int limit) {
        var page = projectDeliveriesPage(ownerId, projectId, limit, "");
        @SuppressWarnings("unchecked") var rows = (List<Map<String, Object>>) page.get("deliveries");
        return rows;
    }

    public Map<String, Object> projectDeliveriesPage(String ownerId, String projectId, int requestedLimit, String cursor) {
        requireProject(ownerId, projectId);
        var limit = Math.max(1, Math.min(100, requestedLimit));
        var offset = V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT d.*,r.title AS report_title,r.version AS report_version
                FROM delivery_operations d
                JOIN report_versions r ON r.id=d.report_version_id
                WHERE d.owner_id=? AND d.project_id=?
                ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?
                """, ownerId, projectId, limit + 1, offset);
        var hasMore = rows.size() > limit;
        if (hasMore) rows = new ArrayList<>(rows.subList(0, limit));
        for (var row : rows) decorateOperation(row);
        var result = new LinkedHashMap<String, Object>();
        result.put("deliveries", rows);
        result.put("limit", limit);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + limit) : null);
        return result;
    }

    public Map<String, Object> detail(String ownerId, String operationId) {
        var rows = jdbc.queryForList("""
                SELECT d.*,r.title AS report_title,r.version AS report_version
                FROM delivery_operations d
                JOIN report_versions r ON r.id=d.report_version_id
                WHERE d.id=? AND d.owner_id=?
                """, operationId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "交付操作不存在");
        var result = new LinkedHashMap<String, Object>(rows.get(0));
        result.put("attempts", jdbc.queryForList("""
                SELECT id,operation_id,attempt,status,execution_result_json,response_code,external_id,error,
                       started_at,finished_at,created_at
                FROM delivery_attempts WHERE operation_id=? ORDER BY attempt
                """, operationId));
        decorateOperation(result);
        var attempts = (List<Map<String, Object>>) result.get("attempts");
        for (var attempt : attempts) {
            attempt.put("executionResult", parseMap(attempt.get("execution_result_json")));
        }
        if (!attempts.isEmpty()) {
            var latest = attempts.get(attempts.size() - 1);
            result.put("latestAttempt", latest.get("attempt"));
            result.put("executionResult", latest.get("executionResult"));
        }
        result.put("businessOutcome", parseMap(result.get("business_outcome_json")));
        result.put("operationId", operationId);
        result.put("stableId", operationId);
        return result;
    }

    public Map<String, Object> report(String ownerId, String reportId) {
        var rows = jdbc.queryForList("SELECT * FROM report_versions WHERE id=? AND owner_id=?", reportId, ownerId);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "正式报告不存在");
        return rows.get(0);
    }

    private void executeAttempt(String ownerId, String operationId, String attemptId, int attempt,
                                Map<String, Object> report, Map<String, Object> rule) {
        var started = now();
        jdbc.update("UPDATE delivery_attempts SET status='running',started_at=? WHERE id=? AND operation_id=? AND status='queued'",
                started, attemptId, operationId);
        jdbc.update("UPDATE delivery_operations SET status='running',updated_at=? WHERE id=? AND owner_id=? AND status='queued'",
                started, operationId, ownerId);
        String status = "unknown";
        String technicalStatus = "unknown";
        String businessStatus = "unknown";
        Integer responseCode = null;
        String externalId = null;
        String error = null;
        var result = new LinkedHashMap<String, Object>();
        result.put("attempt", attempt);
        result.put("operationId", operationId);
        try {
            var endpoint = URI.create(secrets.decrypt(text(rule.get("endpoint_encrypted"))));
            assertPublicHttps(endpoint);
            var payload = new LinkedHashMap<String, Object>();
            payload.put("event", "threadbeacon.report.published");
            payload.put("operationId", operationId);
            payload.put("attempt", attempt);
            payload.put("reportId", report.get("id"));
            payload.put("reportVersion", report.get("version"));
            payload.put("projectId", report.get("project_id"));
            var response = client.send(HttpRequest.newBuilder(endpoint)
                    .timeout(Duration.ofSeconds(15))
                    .header("content-type", "application/json")
                    .header("user-agent", "threadbeacon-v2-delivery/1.0")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload))).build(),
                    HttpResponse.BodyHandlers.discarding());
            responseCode = response.statusCode();
            externalId = firstHeader(response, "X-Delivery-Id", "X-Message-Id", "Location");
            result.put("httpStatus", responseCode);
            if (responseCode >= 200 && responseCode < 300) {
                // A webhook 2xx acknowledges submission, not confirmed business delivery.
                status = "submitted";
                technicalStatus = "submitted";
                businessStatus = "unknown";
                result.put("submitted", true);
                result.put("businessDeliveryConfirmed", false);
            } else if (responseCode >= 400 && responseCode < 500) {
                status = "failed";
                technicalStatus = "failed";
                businessStatus = "failed";
                error = "HTTP " + responseCode;
                result.put("submitted", false);
            } else {
                status = "unknown";
                technicalStatus = "unknown";
                businessStatus = "unknown";
                error = "HTTP " + responseCode + "，外部状态未知";
                result.put("submitted", false);
            }
        } catch (Exception failure) {
            // A timeout/DNS/TLS failure cannot prove that the external side effect did not happen.
            error = safeError(failure);
            result.put("submitted", false);
            result.put("businessDeliveryConfirmed", false);
        }
        if (error != null) result.put("error", error);
        var finished = now();
        result.put("technicalStatus", technicalStatus);
        result.put("businessOutcomeStatus", businessStatus);
        if (responseCode != null) result.put("httpStatus", responseCode);
        var finalStatus = status;
        var finalTechnicalStatus = technicalStatus;
        var finalBusinessStatus = businessStatus;
        var finalResponseCode = responseCode;
        var finalExternalId = externalId;
        var finalError = error;
        transactions.executeWithoutResult(tx -> {
            jdbc.update("""
                    UPDATE delivery_attempts
                    SET status=?,execution_result_json=?,response_code=?,external_id=?,error=?,finished_at=?
                    WHERE id=? AND operation_id=?
                    """, finalStatus, json(mapper, result), finalResponseCode, finalExternalId, finalError,
                    finished, attemptId, operationId);
            var outcome = new LinkedHashMap<String, Object>();
            outcome.put("status", finalBusinessStatus);
            outcome.put("attempt", attempt);
            if (finalError != null) outcome.put("reason", finalError);
            if (finalExternalId != null && !finalExternalId.isBlank()) outcome.put("externalId", finalExternalId);
            jdbc.update("""
                    UPDATE delivery_operations
                    SET status=?,technical_status=?,business_outcome_status=?,business_outcome_json=?,updated_at=?
                    WHERE id=? AND owner_id=?
                    """, finalStatus, finalTechnicalStatus, finalBusinessStatus, json(mapper, outcome), finished,
                    operationId, ownerId);
            audit(ownerId, "delivery.attempt", "delivery_operation", operationId,
                    Map.of("attempt", attempt, "status", finalStatus, "technicalStatus", finalTechnicalStatus,
                            "businessOutcomeStatus", finalBusinessStatus), finished);
        });
    }

    private Map<String, Object> rule(String ownerId, String projectId, String requestedRuleId) {
        List<Map<String, Object>> rows;
        if (!requestedRuleId.isBlank()) {
            rows = jdbc.queryForList("""
                    SELECT * FROM delivery_rules
                    WHERE id=? AND owner_id=? AND enabled=1 AND (project_id IS NULL OR project_id=?)
                    """, requestedRuleId, ownerId, projectId);
        } else {
            rows = jdbc.queryForList("""
                    SELECT * FROM delivery_rules
                    WHERE owner_id=? AND enabled=1 AND (project_id IS NULL OR project_id=?)
                    ORDER BY CASE WHEN project_id=? THEN 0 ELSE 1 END,created_at DESC LIMIT 1
                    """, ownerId, projectId, projectId);
        }
        if (rows.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "项目没有可用的交付规则");
        return rows.get(0);
    }

    private void requireProject(String ownerId, String projectId) {
        if (jdbc.queryForList("SELECT 1 FROM projects WHERE id=? AND owner_id=?", projectId, ownerId).isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "项目不存在");
        }
    }

    private void decorateOperation(Map<String, Object> operation) {
        operation.put("operationId", operation.get("id"));
        operation.put("stableId", operation.get("id"));
        operation.put("destination", parseMap(operation.get("destination_json")));
        operation.put("businessOutcome", parseMap(operation.get("business_outcome_json")));
        operation.put("technicalStatus", operation.get("technical_status"));
        operation.put("businessOutcomeStatus", operation.get("business_outcome_status"));
        operation.put("immutableIntent", true);
    }

    private void audit(String ownerId, String action, String resourceType, String resourceId,
                       Object detail, String timestamp) {
        jdbc.update("""
                INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at)
                VALUES(?,?,?,?,?,?,?)
                """, id(), ownerId, action, resourceType, resourceId, json(mapper, detail), timestamp);
    }

    private Map<String, Object> parseMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked") var result = (Map<String, Object>) map;
            return result;
        }
        if (!(value instanceof String raw) || raw.isBlank()) return new LinkedHashMap<>();
        try {
            return new LinkedHashMap<>(mapper.readValue(raw, new TypeReference<Map<String, Object>>() { }));
        } catch (Exception ignored) {
            return new LinkedHashMap<>();
        }
    }

    private void assertPublicHttps(URI endpoint) throws Exception {
        if (!"https".equalsIgnoreCase(endpoint.getScheme()) || endpoint.getHost() == null
                || endpoint.getUserInfo() != null) {
            throw new IllegalArgumentException("交付端点必须是公网 HTTPS");
        }
        for (var address : InetAddress.getAllByName(endpoint.getHost())) {
            if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress()) {
                throw new IllegalArgumentException("交付端点解析到非公网地址");
            }
        }
    }

    private String safeError(Exception error) {
        var value = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        var redacted = value.replaceAll("(?i)(token|key|secret)=[^&\\s]+", "$1=[REDACTED]");
        return redacted.substring(0, Math.min(1000, redacted.length()));
    }

    private String firstHeader(HttpResponse<?> response, String... names) {
        for (var name : names) {
            var value = response.headers().firstValue(name);
            if (value.isPresent() && !value.get().isBlank()) return value.get();
        }
        return null;
    }
}
