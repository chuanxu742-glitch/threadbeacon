package com.threadbeacon.control.capability;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

@Service
public class CapabilityV2Service {
    private static final Pattern SECRET_KEY = Pattern.compile("(?:^|[-_])(password|passwd|secret|token|api[-_]?key|authorization|cookie|credential)(?:$|[-_])", Pattern.CASE_INSENSITIVE);
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final CurrentUser user;

    public CapabilityV2Service(JdbcTemplate jdbc, ObjectMapper mapper, CurrentUser user) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.user = user;
    }

    public Map<String, Object> readiness() {
        var checkedAt = now();
        var resources = executionResources();
        var items = new ArrayList<Map<String, Object>>();
        if (resources.isEmpty()) {
            items.add(item("EXECUTION_RESOURCE_REQUIRED", "missing_resource", "没有配置执行资源", Map.of("type", "workspace", "id", user.ownerId()), "/setup"));
        } else if (resources.stream().noneMatch(row -> "ready".equals(text(row.get("status"))))) {
            items.add(item("EXECUTION_RESOURCE_OFFLINE", "degraded", "执行资源当前均不在线", Map.of("type", "workspace", "id", user.ownerId()), "/setup"));
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("status", items.isEmpty() ? "ready" : text(items.get(0).get("status")));
        result.put("ready", items.isEmpty());
        result.put("lastCheckedAt", checkedAt);
        result.put("items", items);
        result.put("capabilities", capabilityCatalog(resources));
        return result;
    }

    public List<Map<String, Object>> executionResources() {
        var cutoff = Instant.now().minus(60, ChronoUnit.SECONDS).toString();
        var rows = jdbc.queryForList("""
                SELECT id,name,platform,version,capabilities_json,runtime_json,health_json,transport_mode,
                       max_concurrency,active_jobs,status,last_seen_at,created_at
                FROM nodes ORDER BY last_seen_at DESC LIMIT 100
                """);
        return rows.stream().map(row -> {
            var result = new LinkedHashMap<String, Object>(row);
            var online = "online".equals(text(row.get("status"))) && text(row.get("last_seen_at")).compareTo(cutoff) >= 0;
            result.put("status", online ? "ready" : "offline");
            result.put("kind", "worker");
            result.put("lastCheckedAt", now());
            return (Map<String, Object>) result;
        }).toList();
    }

    public List<Map<String, Object>> connections() {
        return jdbc.queryForList("""
                SELECT id,name,kind,status,config_json,secret_ref,last_verified_at,last_error,created_at,updated_at
                FROM connections WHERE owner_id=? ORDER BY updated_at DESC
                """, user.ownerId()).stream().map(this::connectionProjection).toList();
    }

    private Map<String, Object> connectionProjection(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id"));
        result.put("name", row.get("name"));
        result.put("kind", row.get("kind"));
        result.put("status", row.get("status"));
        result.put("config", sanitizeMap(parseMap(row.get("config_json"))));
        result.put("secretRef", row.get("secret_ref"));
        result.put("lastVerifiedAt", row.get("last_verified_at"));
        result.put("lastError", row.get("last_error"));
        result.put("createdAt", row.get("created_at"));
        result.put("updatedAt", row.get("updated_at"));
        return result;
    }

    private List<Map<String, Object>> capabilityCatalog(List<Map<String, Object>> resources) {
        var result = new LinkedHashMap<String, Map<String, Object>>();
        for (var resource : resources) {
            if (!"ready".equals(text(resource.get("status")))) continue;
            for (var capability : parseStrings(resource.get("capabilities_json"))) {
                result.computeIfAbsent(capability, ignored -> new LinkedHashMap<>(Map.of(
                        "id", capability, "status", "ready", "onlineResources", 0))).compute("onlineResources", (key, value) -> ((Number) value).intValue() + 1);
            }
        }
        return new ArrayList<>(result.values());
    }

    private Map<String, Object> item(String code, String status, String message, Map<String, Object> affected,
                                      String remediationRoute) {
        return Map.of("code", code, "status", status, "message", message, "affectedObject", affected,
                "remediationRoute", remediationRoute, "lastCheckedAt", now(), "evidence", Map.of());
    }

    private List<String> parseStrings(Object raw) {
        try { return mapper.readValue(text(raw), new TypeReference<List<String>>() {}); }
        catch (Exception ignored) { return List.of(); }
    }

    private Map<String, Object> parseMap(Object raw) {
        try { return mapper.readValue(text(raw), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception ignored) { return Map.of(); }
    }

    private Map<String, Object> sanitizeMap(Map<String, Object> input) {
        var result = new LinkedHashMap<String, Object>();
        for (var entry : input.entrySet()) {
            var key = entry.getKey();
            if (key == null || SECRET_KEY.matcher(key).find()) continue;
            var value = entry.getValue();
            if (value instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked") var nested = (Map<String, Object>) map;
                result.put(key, sanitizeMap(nested));
            } else if (value instanceof List<?> list) result.put(key, list.stream().map(this::sanitizeValue).toList());
            else result.put(key, value);
        }
        return result;
    }

    private Object sanitizeValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked") var nested = (Map<String, Object>) map;
            return sanitizeMap(nested);
        }
        if (value instanceof List<?> list) return list.stream().map(this::sanitizeValue).toList();
        return value;
    }
}
