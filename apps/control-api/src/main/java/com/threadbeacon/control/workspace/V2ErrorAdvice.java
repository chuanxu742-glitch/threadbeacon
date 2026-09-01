package com.threadbeacon.control.workspace;

import com.threadbeacon.control.common.ApiException;
import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Keeps v2 errors actionable without changing the legacy /api error shape. */
@Order(0)
@RestControllerAdvice(basePackages = {
        "com.threadbeacon.control.workspace",
        "com.threadbeacon.control.project",
        "com.threadbeacon.control.source",
        "com.threadbeacon.control.workflow",
        "com.threadbeacon.control.run",
        "com.threadbeacon.control.capability",
        "com.threadbeacon.control.research",
        "com.threadbeacon.control.report",
        "com.threadbeacon.control.delivery",
        "com.threadbeacon.control.attention",
        "com.threadbeacon.control.automation",
        "com.threadbeacon.control.social"
})
public class V2ErrorAdvice {
    @ExceptionHandler(V2ApiException.class)
    ResponseEntity<Map<String, Object>> v2(V2ApiException error) {
        return ResponseEntity.status(error.status()).body(body(error.code(), error.getMessage(), error.details()));
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> legacy(ApiException error) {
        return ResponseEntity.status(error.status()).body(body("REQUEST_REJECTED", error.getMessage(), Map.of()));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> unexpected(Exception error) {
        return ResponseEntity.internalServerError().body(body("INTERNAL_ERROR", "服务内部错误", Map.of()));
    }

    private Map<String, Object> body(String code, String message, Map<String, Object> details) {
        var result = new LinkedHashMap<String, Object>();
        result.put("code", code);
        result.put("message", message);
        result.put("details", details == null ? Map.of() : details);
        result.put("correlationId", correlationId());
        return result;
    }

    private String correlationId() {
        var requestId = MDC.get("requestId");
        return requestId == null || requestId.isBlank() ? UUID.randomUUID().toString() : requestId;
    }
}
