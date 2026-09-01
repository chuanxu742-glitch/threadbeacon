package com.threadbeacon.control.social;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.text;

/** Maps persisted rows to safe social API projections. */
@Component
public final class SocialProjectionMapper {
    private static final Pattern HASHTAG = Pattern.compile("#[\\p{L}\\p{N}_-]{1,100}");
    private final ObjectMapper mapper;

    public SocialProjectionMapper(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public Map<String, Object> monitor(Map<String, Object> row, int alertCount, int openAlertCount) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id"));
        result.put("projectId", row.get("project_id"));
        result.put("name", row.get("name"));
        result.put("type", row.get("monitor_type"));
        result.put("monitorType", row.get("monitor_type"));
        result.put("kind", row.get("monitor_type"));
        result.put("query", row.get("query"));
        result.put("config", SocialV2Policy.sanitize(parseMap(row.get("config_json"))));
        result.put("sourceId", row.get("source_id"));
        result.put("intervalMinutes", row.get("interval_minutes"));
        result.put("status", row.get("status"));
        result.put("enabled", "active".equals(text(row.get("status"))));
        result.put("revision", integer(row.get("revision"), 1));
        result.put("lastRunAt", row.get("last_run_at"));
        result.put("lastRunObservationId", row.get("last_run_observation_id"));
        result.put("lastSeenAt", row.get("last_seen_at"));
        result.put("lastError", row.get("last_error"));
        result.put("archived", !text(row.get("archived_at")).isBlank());
        result.put("createdAt", row.get("created_at"));
        result.put("updatedAt", row.get("updated_at"));
        result.put("alertCount", alertCount);
        result.put("openAlertCount", openAlertCount);
        return result;
    }

    public Map<String, Object> content(String ownerId, Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        var observationId = row.get("observation_id");
        // payload_json is the immutable observation envelope. Prefer a nested
        // normalized v1 object when the worker already supplied one; otherwise
        // fall back to the legacy SourceItem-shaped payload.
        var payload = parseMap(row.get("payload_json"));
        var envelope = socialEnvelope(payload);
        var raw = envelope.isEmpty() ? payload : envelope;
        var nestedRaw = asMap(payload.get("raw"));
        if (nestedRaw.isEmpty()) nestedRaw = asMap(raw.get("raw"));
        var platform = firstText(raw.get("platform"), row.get("platform"));
        var contentType = firstText(raw.get("contentType"), raw.get("itemType"), row.get("item_type"));
        if (contentType.isBlank()) contentType = "post";
        var externalId = firstText(raw.get("externalId"), raw.get("id"), row.get("source_item_id"));
        if (externalId.isBlank()) externalId = text(observationId);
        var title = firstText(raw.get("title"), row.get("title"));
        var body = firstText(raw.get("text"), raw.get("content"), row.get("content"));
        var publishedAt = firstText(raw.get("publishedAt"), raw.get("postedAt"), row.get("observed_at"));
        var observedAt = firstText(raw.get("observedAt"), row.get("captured_at"));
        var canonicalUrl = safeUrl(firstText(raw.get("canonicalUrl"), raw.get("url"), row.get("url"), row.get("source_url")));

        // Normalized v1 envelope.  Unknown provider lineage is intentionally omitted;
        // persisted observations do not carry a trustworthy provider/legal claim.
        result.put("schema", "threadbeacon.social.observation.v1");
        result.put("observationId", observationId);
        result.put("platform", platform);
        result.put("contentType", contentType);
        result.put("externalId", externalId);
        putIfPresent(result, "canonicalUrl", canonicalUrl);
        var normalizedAuthor = author(row, raw, nestedRaw, platform);
        if (!normalizedAuthor.isEmpty()) result.put("author", normalizedAuthor);
        result.put("text", body);
        putIfPresent(result, "title", title);
        result.put("publishedAt", publishedAt);
        result.put("observedAt", observedAt);
        var engagement = engagement(raw.containsKey("engagement") ? raw.get("engagement") : row.get("metrics_json"));
        if (!engagement.isEmpty()) result.put("engagement", engagement);
        var tags = tags(raw, nestedRaw, title + "\n" + body);
        result.put("topics", tags);
        result.put("tags", tags);
        var parentId = firstText(raw.get("parentId"), raw.get("parent_id"), nestedRaw.get("parentId"), nestedRaw.get("parent_id"));
        var conversationId = firstText(raw.get("conversationId"), raw.get("conversation_id"), raw.get("threadId"),
                raw.get("thread_id"), raw.get("replyRoot"), raw.get("rootUri"), raw.get("root_uri"), raw.get("linkId"),
                nestedRaw.get("conversationId"), nestedRaw.get("conversation_id"), nestedRaw.get("threadId"),
                nestedRaw.get("thread_id"), nestedRaw.get("replyRoot"), nestedRaw.get("rootUri"), nestedRaw.get("root_uri"),
                nestedRaw.get("linkId"));
        if (conversationId.isBlank()) conversationId = "comment".equals(contentType) && !parentId.isBlank() ? parentId : externalId;
        putIfPresent(result, "conversationId", conversationId);
        putIfPresent(result, "parentId", parentId);
        result.put("sentiment", Map.of("status", "pending"));
        result.put("contentHash", firstText(raw.get("contentHash"), row.get("content_hash")));
        result.put("source", source(row, raw, nestedRaw, platform, observationId, observedAt));

        // Existing v2 clients consume these aliases while migrating to the envelope.
        result.put("id", observationId);
        result.put("recordId", row.get("record_id"));
        result.put("projectId", row.get("project_id"));
        result.put("jobId", row.get("job_id"));
        result.put("sourceItemId", row.get("source_item_id"));
        result.put("itemType", contentType);
        if (!result.containsKey("title")) result.put("title", row.get("title"));
        result.put("content", body);
        result.put("authorName", row.get("author"));
        result.put("url", safeUrl(text(row.get("url"))));
        result.put("sourceUrl", safeUrl(text(row.get("source_url"))));
        result.put("changeType", row.get("change_type"));
        result.put("capturedAt", row.get("captured_at"));
        result.put("metrics", SocialV2Policy.sanitize(parseMap(row.get("metrics_json"))));
        var authorName = text(row.get("author"));
        if (authorName.isBlank()) authorName = SocialV2Policy.authorText(normalizedAuthor);
        if (authorName.isBlank()) {
            result.put("account", null);
        } else {
            var account = new LinkedHashMap<String, Object>();
            account.put("id", SocialV2Policy.accountId(ownerId, text(row.get("project_id")), platform, authorName));
            account.put("platform", platform);
            account.put("handle", authorName.startsWith("@") ? authorName : "@" + authorName);
            account.put("displayName", authorName);
            result.put("account", account);
        }
        return result;
    }

    private Map<String, Object> author(Map<String, Object> row, Map<String, Object> raw,
                                       Map<String, Object> nestedRaw, String platform) {
        var rawAuthor = asMap(raw.get("author"));
        var nestedAuthor = asMap(nestedRaw.get("author"));
        var fallback = text(row.get("author"));
        var id = firstText(rawAuthor.get("id"), rawAuthor.get("authorId"), rawAuthor.get("author_id"),
                raw.get("authorId"), raw.get("author_id"), nestedRaw.get("authorId"), nestedRaw.get("author_id"));
        var handle = firstText(rawAuthor.get("handle"), rawAuthor.get("username"), rawAuthor.get("uniqueId"),
                nestedAuthor.get("handle"), nestedAuthor.get("username"), nestedAuthor.get("uniqueId"),
                raw.get("authorHandle"), raw.get("author_handle"), raw.get("handle"), raw.get("username"), raw.get("uniqueId"),
                nestedRaw.get("authorHandle"), nestedRaw.get("author_handle"), nestedRaw.get("handle"),
                nestedRaw.get("username"), nestedRaw.get("uniqueId"));
        var name = firstText(rawAuthor.get("name"), rawAuthor.get("displayName"), rawAuthor.get("display_name"),
                nestedAuthor.get("name"), nestedAuthor.get("displayName"), nestedAuthor.get("display_name"),
                raw.get("authorName"), raw.get("author_name"), raw.get("displayName"), raw.get("display_name"),
                raw.get("authorDisplayName"), nestedRaw.get("authorName"), nestedRaw.get("author_name"),
                nestedRaw.get("displayName"), nestedRaw.get("display_name"), nestedRaw.get("authorDisplayName"));
        if (handle.isBlank() && ("reddit".equals(platform) || "bluesky".equals(platform) || fallback.startsWith("@"))) handle = fallback;
        if (name.isBlank() && !"reddit".equals(platform) && !"bluesky".equals(platform)) name = fallback;
        var url = firstText(rawAuthor.get("url"), rawAuthor.get("profileUrl"), rawAuthor.get("profile_url"),
                nestedAuthor.get("url"), nestedAuthor.get("profileUrl"), nestedAuthor.get("profile_url"),
                raw.get("authorUrl"), raw.get("author_url"), raw.get("profileUrl"), raw.get("profile_url"),
                raw.get("userUrl"), raw.get("user_url"), nestedRaw.get("authorUrl"), nestedRaw.get("author_url"),
                nestedRaw.get("authorChannelUrl"), nestedRaw.get("author_channel_url"), nestedRaw.get("profileUrl"),
                nestedRaw.get("profile_url"), nestedRaw.get("userUrl"), nestedRaw.get("user_url"));
        var result = new LinkedHashMap<String, Object>();
        putIfPresent(result, "id", id);
        putIfPresent(result, "handle", handle);
        putIfPresent(result, "name", name);
        putIfPresent(result, "url", safeUrl(url));
        return result;
    }

    private Map<String, Object> source(Map<String, Object> row, Map<String, Object> raw,
                                       Map<String, Object> nestedRaw, String platform, Object observationId,
                                       String observedAt) {
        var lineage = asMap(raw.get("source"));
        if (lineage.isEmpty()) lineage = asMap(nestedRaw.get("source"));
        var result = new LinkedHashMap<String, Object>();
        putIfPresent(result, "providerId", firstText(lineage.get("providerId"), raw.get("providerId"), nestedRaw.get("providerId")));
        putIfPresent(result, "sourceId", firstText(lineage.get("sourceId"), raw.get("sourceId"), nestedRaw.get("sourceId")));
        result.put("observationId", observationId);
        putIfPresent(result, "legalBasis", firstText(lineage.get("legalBasis"), raw.get("legalBasis"), nestedRaw.get("legalBasis")));
        putIfPresent(result, "capabilityTier", firstText(lineage.get("capabilityTier"), raw.get("capabilityTier"), nestedRaw.get("capabilityTier")));
        result.put("platform", platform);
        putIfPresent(result, "providerKind", firstText(lineage.get("providerKind"), raw.get("providerKind"), nestedRaw.get("providerKind")));
        putIfPresent(result, "mode", firstText(lineage.get("mode"), raw.get("mode"), nestedRaw.get("mode")));
        putIfPresent(result, "auth", firstText(lineage.get("auth"), raw.get("auth"), nestedRaw.get("auth")));
        putIfPresent(result, "robots", firstText(lineage.get("robots"), raw.get("robots"), nestedRaw.get("robots")));
        var fetchedAt = firstText(lineage.get("fetchedAt"), raw.get("fetchedAt"), nestedRaw.get("fetchedAt"));
        if (fetchedAt.isBlank()) fetchedAt = observedAt;
        putIfPresent(result, "fetchedAt", fetchedAt);
        return result;
    }

    private Map<String, Object> socialEnvelope(Map<String, Object> payload) {
        if ("threadbeacon.social.observation.v1".equals(text(payload.get("schema")))) return payload;
        for (var key : List.of("socialObservation", "social_observation", "normalized", "observation")) {
            var candidate = asMap(payload.get(key));
            if ("threadbeacon.social.observation.v1".equals(text(candidate.get("schema")))) return candidate;
        }
        return Map.of();
    }

    /** Removes tracking/session query parameters before any URL reaches a v2 response. */
    private String safeUrl(String value) {
        if (value == null || value.isBlank()) return "";
        var hash = value.indexOf('#');
        var withoutFragment = hash >= 0 ? value.substring(0, hash) : value;
        var question = withoutFragment.indexOf('?');
        if (question < 0) return withoutFragment;
        var base = withoutFragment.substring(0, question);
        var kept = new ArrayList<String>();
        for (var part : withoutFragment.substring(question + 1).split("&")) {
            if (part.isBlank()) continue;
            var equals = part.indexOf('=');
            var key = equals >= 0 ? part.substring(0, equals) : part;
            if (isSensitiveQueryKey(key)) continue;
            kept.add(part);
        }
        return kept.isEmpty() ? base : base + "?" + String.join("&", kept);
    }

    private boolean isSensitiveQueryKey(String key) {
        var normalized = key.toLowerCase(java.util.Locale.ROOT).replace("-", "").replace("_", "");
        return normalized.contains("token") || normalized.contains("secret") || normalized.contains("password")
                || normalized.contains("credential") || normalized.contains("authorization") || normalized.contains("cookie")
                || normalized.equals("apikey") || normalized.equals("key") || normalized.equals("xseccsource")
                || normalized.equals("xsectoken") || normalized.equals("fbclid") || normalized.startsWith("utm");
    }

    private Map<String, Object> engagement(Object rawMetrics) {
        var metrics = parseMap(rawMetrics);
        var result = new LinkedHashMap<String, Object>();
        metric(result, "likes", metrics, "likes", "likeCount");
        metric(result, "comments", metrics, "comments", "commentCount");
        metric(result, "shares", metrics, "shares", "shareCount");
        metric(result, "views", metrics, "views", "viewCount");
        return result;
    }

    private void metric(Map<String, Object> target, String normalized, Map<String, Object> metrics, String... keys) {
        for (var key : keys) {
            var value = metricValue(metrics.get(key));
            if (value != null) { target.put(normalized, value); return; }
        }
    }

    private Number metricValue(Object value) {
        if (value instanceof Number number && number.doubleValue() >= 0 && Double.isFinite(number.doubleValue())) return number;
        if (value instanceof String string) {
            try {
                var parsed = Double.parseDouble(string.trim());
                if (Double.isFinite(parsed) && parsed >= 0) return parsed == Math.rint(parsed) ? (long) parsed : parsed;
            } catch (NumberFormatException ignored) { }
        }
        return null;
    }

    private List<String> tags(Map<String, Object> raw, Map<String, Object> nestedRaw, String text) {
        var result = new LinkedHashSet<String>();
        for (var key : List.of("hashtags", "tags", "topics", "topicTags", "topic_tags")) {
            addTags(result, raw.get(key)); addTags(result, nestedRaw.get(key));
        }
        Matcher matcher = HASHTAG.matcher(text == null ? "" : text);
        while (matcher.find()) addTag(result, matcher.group());
        return new ArrayList<>(result);
    }

    private void addTags(Set<String> target, Object value) {
        if (value instanceof List<?> values) { for (var item : values) addTags(target, item); return; }
        if (value instanceof Map<?, ?> map) {
            for (var key : List.of("label", "name", "tag", "hashtag", "cha_name", "text")) {
                if (map.containsKey(key)) { addTags(target, map.get(key)); return; }
            }
            return;
        }
        if (value instanceof String string) for (var part : string.split("[\\s,，、]+")) addTag(target, part);
    }

    private void addTag(Set<String> target, String raw) {
        var tag = raw == null ? "" : raw.replaceFirst("^#+", "").trim().replaceAll("[。！？!?，,;；]+$", "");
        if (!tag.isBlank()) target.add(tag);
    }

    private Map<String, Object> asMap(Object raw) {
        if (!(raw instanceof Map<?, ?> map)) return Map.of();
        var result = new LinkedHashMap<String, Object>();
        for (var entry : map.entrySet()) if (entry.getKey() instanceof String key) result.put(key, entry.getValue());
        return result;
    }

    private String firstText(Object... values) {
        for (var value : values) {
            var text = text(value);
            if (!text.isBlank()) return text;
        }
        return "";
    }

    private void putIfPresent(Map<String, Object> target, String key, String value) {
        if (value != null && !value.isBlank()) target.put(key, value);
    }

    public Map<String, Object> alert(Map<String, Object> row) {
        var result = new LinkedHashMap<String, Object>();
        result.put("id", row.get("id"));
        result.put("projectId", row.get("project_id"));
        result.put("monitorId", row.get("monitor_id"));
        result.put("observationId", row.get("observation_id"));
        result.put("kind", row.get("kind"));
        result.put("severity", row.get("severity"));
        result.put("status", row.get("status"));
        result.put("title", row.get("title"));
        result.put("message", row.get("message"));
        result.put("rule", SocialV2Policy.sanitize(parseMap(row.get("rule_json"))));
        result.put("evidence", SocialV2Policy.sanitize(parseMap(row.get("evidence_json"))));
        result.put("revision", integer(row.get("revision"), 1));
        result.put("resolvedBy", row.get("resolved_by"));
        result.put("resolutionReason", row.get("resolution_reason"));
        result.put("resolvedAt", row.get("resolved_at"));
        result.put("createdAt", row.get("created_at"));
        result.put("updatedAt", row.get("updated_at"));
        result.put("resolved", !"open".equals(text(row.get("status"))));
        return result;
    }

    public Map<String, Object> parseMap(Object raw) {
        if (raw instanceof Map<?, ?> map) {
            var result = new LinkedHashMap<String, Object>();
            for (var entry : map.entrySet()) if (entry.getKey() instanceof String key) result.put(key, entry.getValue());
            return result;
        }
        var value = text(raw);
        if (value.isBlank()) return Map.of();
        try {
            return mapper.readValue(value, new TypeReference<Map<String, Object>>() {});
        } catch (Exception ignored) {
            return Map.of();
        }
    }
}
