package com.threadbeacon.control.workspace;

import org.springframework.http.HttpStatus;

import java.util.Map;

/** Stable error used by the v2 resource API. */
public class V2ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final Map<String, Object> details;

    public V2ApiException(HttpStatus status, String code, String message) {
        this(status, code, message, Map.of());
    }

    public V2ApiException(HttpStatus status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details == null ? Map.of() : Map.copyOf(details);
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public Map<String, Object> details() {
        return details;
    }
}
