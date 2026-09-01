package com.threadbeacon.control.delivery;

import com.threadbeacon.control.common.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** v2 delivery intent, attempt and outcome endpoints. */
@RestController
@RequestMapping("/api/v2")
public class DeliveryController {
    private final DeliveryApplicationService deliveries;
    private final CurrentUser user;

    public DeliveryController(DeliveryApplicationService deliveries, CurrentUser user) {
        this.deliveries = deliveries;
        this.user = user;
    }

    @PostMapping("/reports/{reportId}/deliveries")
    public ResponseEntity<Map<String, Object>> create(@PathVariable String reportId,
                                                       @RequestBody(required = false) Map<String, Object> body,
                                                       @RequestHeader(value = "Idempotency-Key", required = false)
                                                       String idempotencyKey) {
        user.requireScope("records:read");
        user.requireRole("editor");
        var operation = deliveries.create(user.ownerId(), reportId, body == null ? Map.of() : body, idempotencyKey);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("delivery", operation,
                "operation", operation));
    }

    @PostMapping("/deliveries/{operationId}/retry")
    public ResponseEntity<Map<String, Object>> retry(@PathVariable String operationId) {
        user.requireScope("records:read");
        user.requireRole("editor");
        var operation = deliveries.retry(user.ownerId(), operationId);
        return ResponseEntity.ok(Map.of("delivery", operation, "operation", operation));
    }

    @GetMapping("/projects/{projectId}/deliveries")
    public Map<String, Object> list(@PathVariable String projectId,
                                    @RequestParam(defaultValue = "50") int limit,
                                    @RequestParam(defaultValue = "") String cursor) {
        user.requireScope("records:read");
        var page = deliveries.projectDeliveriesPage(user.ownerId(), projectId, limit, cursor);
        @SuppressWarnings("unchecked") var rows = (java.util.List<Map<String, Object>>) page.get("deliveries");
        page.put("operations", rows);
        return page;
    }

    @GetMapping("/deliveries/{operationId}")
    public Map<String, Object> detail(@PathVariable String operationId) {
        user.requireScope("records:read");
        var operation = deliveries.detail(user.ownerId(), operationId);
        return Map.of("delivery", operation, "operation", operation);
    }
}
