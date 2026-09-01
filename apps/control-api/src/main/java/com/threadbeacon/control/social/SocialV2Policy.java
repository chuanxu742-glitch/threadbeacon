package com.threadbeacon.control.social;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static com.threadbeacon.control.common.Values.hash;
import static com.threadbeacon.control.common.Values.text;

/** Pure normalization and safety rules shared by the social projections. */
public final class SocialV2Policy {
    private static final Pattern SECRET_KEY = Pattern.compile(
            "password|passwd|secret|token|apikey|authorization|cookie|credential|privatekey",
            Pattern.CASE_INSENSITIVE);
    private static final Set<String> TYPES = Set.of("keyword", "account", "topic");

    private SocialV2Policy() {}

    public static String type(Object raw) {
        var value = text(raw).toLowerCase(Locale.ROOT);
        if ("watch".equals(value) || "monitor".equals(value)) value = "keyword";
        if (!TYPES.contains(value)) return "";
        return value;
    }

    public static Map<String, Object> sanitize(Map<String, Object> input) {
        var result = new LinkedHashMap<String, Object>();
        if (input == null) return result;
        for (var entry : input.entrySet()) {
            var key = entry.getKey();
            if (key == null || SECRET_KEY.matcher(key).find()) continue;
            result.put(key, sanitizeValue(entry.getValue()));
        }
        return result;
    }

    private static Object sanitizeValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            var nested = new LinkedHashMap<String, Object>();
            for (var entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key) || SECRET_KEY.matcher(key).find()) continue;
                nested.put(key, sanitizeValue(entry.getValue()));
            }
            return nested;
        }
        if (value instanceof List<?> list) return list.stream().map(SocialV2Policy::sanitizeValue).toList();
        return value;
    }

    public static Map<String, Object> parseMap(Object raw, ObjectMapper mapper) {
        if (raw instanceof Map<?, ?> map) {
            var copy = new LinkedHashMap<String, Object>();
            for (var entry : map.entrySet()) {
                if (entry.getKey() instanceof String key) copy.put(key, entry.getValue());
            }
            return copy;
        }
        var value = text(raw);
        if (value.isBlank()) return Map.of();
        try {
            return mapper.readValue(value, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    public static List<String> strings(Object raw) {
        if (raw instanceof String value && !value.isBlank()) return List.of(value.trim());
        if (!(raw instanceof List<?> list)) return List.of();
        return list.stream().map(value -> text(value)).filter(value -> !value.isBlank()).toList();
    }

    public static List<String> terms(String type, String query, Map<String, Object> config) {
        var result = new ArrayList<String>();
        if (query != null && !query.isBlank()) result.add(query.trim());
        for (var key : List.of("keywords", "topics", "terms", "handles", "accounts")) {
            result.addAll(strings(config.get(key)));
        }
        if ("account".equals(type)) {
            for (var key : List.of("handle", "username", "account")) result.addAll(strings(config.get(key)));
        }
        return result.stream().map(value -> value.trim().replaceFirst("^@", ""))
                .filter(value -> !value.isBlank()).distinct().toList();
    }

    public static boolean matches(String type, String query, Map<String, Object> config,
                                  Map<String, Object> content) {
        var platforms = strings(config.get("platforms")).stream()
                .map(value -> value.toLowerCase(Locale.ROOT)).toList();
        var platform = text(content.get("platform")).toLowerCase(Locale.ROOT);
        if (!platforms.isEmpty() && !platforms.contains(platform)) return false;
        var terms = terms(type, query, config).stream().map(value -> value.toLowerCase(Locale.ROOT)).toList();
        if (terms.isEmpty()) return false;
        var author = authorText(content.get("author")).toLowerCase(Locale.ROOT).replaceFirst("^@", "");
        var haystack = (text(content.get("title")) + "\n" + text(content.get("content")) + "\n"
                + author + "\n" + text(content.get("sourceItemId"))).toLowerCase(Locale.ROOT);
        if ("account".equals(type)) return terms.stream().anyMatch(term -> author.equals(term) || author.contains(term));
        return terms.stream().anyMatch(haystack::contains);
    }

    /** Accepts both the legacy scalar author and the normalized author object. */
    public static String authorText(Object raw) {
        if (raw instanceof Map<?, ?> map) {
            for (var key : List.of("handle", "name", "id")) {
                var value = text(map.get(key));
                if (!value.isBlank()) return value;
            }
            return "";
        }
        return text(raw);
    }

    public static int severity(Map<String, Object> config) {
        var value = config.get("severity");
        if (value instanceof Number number) return Math.max(0, Math.min(5, number.intValue()));
        return 2;
    }

    public static String accountId(String ownerId, String projectId, String platform, String author) {
        return "account:" + hash(ownerId + "|" + projectId + "|" + platform + "|" + author.toLowerCase(Locale.ROOT))
                .substring(0, 24);
    }
}
