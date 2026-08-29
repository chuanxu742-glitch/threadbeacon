package com.threadbeacon.control.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class Values {
    private Values() {}

    public static String id() { return UUID.randomUUID().toString(); }
    public static String now() { return Instant.now().toString(); }

    public static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    public static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
    }

    public static String text(Object value) { return value instanceof String string ? string.trim() : ""; }
    public static int integer(Object value, int fallback) {
        if (value instanceof Number number) return number.intValue();
        return fallback;
    }
    public static boolean bool(Object value, boolean fallback) { return value instanceof Boolean bool ? bool : fallback; }

    public static String json(ObjectMapper mapper, Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (JsonProcessingException error) { throw new ApiException(HttpStatus.BAD_REQUEST, "JSON 数据无效"); }
    }

    public static Map<String, Object> object(Object value) {
        if (value instanceof Map<?, ?> input) {
            @SuppressWarnings("unchecked") var result = (Map<String, Object>) input;
            return result;
        }
        return Map.of();
    }

    public static List<Object> array(Object value) {
        if (value instanceof List<?> list) return new ArrayList<>(list);
        return List.of();
    }

    public static List<String> strings(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream().filter(String.class::isInstance).map(String.class::cast).toList();
    }

    public static Object parse(ObjectMapper mapper, Object value, Object fallback) {
        if (!(value instanceof String text) || text.isBlank()) return fallback;
        try { return mapper.readValue(text, new TypeReference<>() {}); }
        catch (JsonProcessingException ignored) { return fallback; }
    }
}
