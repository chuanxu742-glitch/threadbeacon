package com.threadbeacon.control.social;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SocialProjectionMapperTest {
    @Test
    void contentUsesTheSocialObservationV1EnvelopeWithoutInventingLineage() {
        var mapper = new SocialProjectionMapper(new ObjectMapper());
        var row = new LinkedHashMap<String, Object>();
        row.put("observation_id", "observation-1");
        row.put("record_id", "record-1");
        row.put("project_id", "project-1");
        row.put("job_id", "job-1");
        row.put("platform", "youtube");
        row.put("source_item_id", "video-1");
        row.put("item_type", "post");
        row.put("title", "Razormind #research");
        row.put("content", "A public update");
        row.put("author", "Channel name");
        row.put("url", "https://youtube.example/video-1");
        row.put("source_url", "https://youtube.example/video-1");
        row.put("content_hash", "hash-1");
        row.put("change_type", "new");
        row.put("observed_at", "2026-08-30T10:00:00.000Z");
        row.put("captured_at", "2026-08-31T12:00:00.000Z");
        row.put("metrics_json", "{\"likes\":7,\"comments\":2}");
        row.put("payload_json", "{\"authorId\":\"UC123\",\"hashtags\":[\"research\"],\"raw\":{\"authorChannelUrl\":\"https://youtube.example/channel/UC123\"},\"source\":{\"providerId\":\"youtube-data-api-v3\",\"legalBasis\":\"provider fixture\",\"capabilityTier\":\"official\"}}");

        var content = mapper.content("owner-1", row);

        assertThat(content).containsEntry("schema", "threadbeacon.social.observation.v1")
                .containsEntry("observationId", "observation-1")
                .containsEntry("externalId", "video-1")
                .containsEntry("publishedAt", "2026-08-30T10:00:00.000Z")
                .containsEntry("observedAt", "2026-08-31T12:00:00.000Z");
        assertThat(content.get("author")).isEqualTo(Map.of(
                "id", "UC123", "name", "Channel name", "url", "https://youtube.example/channel/UC123"));
        assertThat(content.get("engagement")).isEqualTo(Map.of("likes", 7, "comments", 2));
        assertThat(content.get("topics")).asList().contains("research");
        assertThat(content.get("tags")).asList().contains("research");
        assertThat(content.get("sentiment")).isEqualTo(Map.of("status", "pending"));
        @SuppressWarnings("unchecked")
        var source = (Map<String, Object>) content.get("source");
        assertThat(source).containsEntry("providerId", "youtube-data-api-v3")
                .containsEntry("observationId", "observation-1")
                .containsEntry("platform", "youtube")
                .containsEntry("legalBasis", "provider fixture")
                .containsEntry("capabilityTier", "official");
    }

    @Test
    void unknownProviderClaimsAreOmittedAndLegacyRowsStillProduceRequiredFields() {
        var mapper = new SocialProjectionMapper(new ObjectMapper());
        var row = new LinkedHashMap<String, Object>();
        row.put("observation_id", "observation-2");
        row.put("platform", "rss");
        row.put("source_item_id", "item-2");
        row.put("item_type", "post");
        row.put("content", "plain text");
        row.put("author", "@alice");
        row.put("observed_at", "2026-08-30T10:00:00.000Z");
        row.put("captured_at", "2026-08-31T12:00:00.000Z");
        row.put("metrics_json", "{}");
        row.put("payload_json", "{}");

        var content = mapper.content("owner-1", row);
        @SuppressWarnings("unchecked")
        var source = (Map<String, Object>) content.get("source");
        assertThat(source).containsEntry("observationId", "observation-2").containsEntry("platform", "rss");
        assertThat(source).doesNotContainKeys("providerId", "legalBasis", "capabilityTier");
        assertThat(content).containsKeys("schema", "contentType", "externalId", "text", "publishedAt",
                "observedAt", "topics", "tags", "sentiment", "contentHash", "source");
        assertThat(content).doesNotContainKey("engagement");
    }

    @Test
    void embeddedEnvelopeWinsAndRawPayloadUrlsNeverReachTheResponse() {
        var mapper = new SocialProjectionMapper(new ObjectMapper());
        var row = new LinkedHashMap<String, Object>();
        row.put("observation_id", "observation-3");
        row.put("project_id", "project-1");
        row.put("platform", "youtube");
        row.put("source_item_id", "legacy-item");
        row.put("item_type", "post");
        row.put("content", "legacy text");
        row.put("observed_at", "2026-08-30T10:00:00.000Z");
        row.put("captured_at", "2026-08-31T12:00:00.000Z");
        row.put("metrics_json", "{}");
        row.put("payload_json", "{\"socialObservation\":{\"schema\":\"threadbeacon.social.observation.v1\",\"platform\":\"youtube\",\"contentType\":\"post\",\"externalId\":\"embedded-item\",\"canonicalUrl\":\"https://example.test/post?id=1&xsec_token=secret\",\"text\":\"embedded text\",\"publishedAt\":\"2026-08-29T10:00:00.000Z\",\"source\":{\"observationId\":\"wrong\"}},\"url\":\"https://example.test/?xsec_token=secret\"}");

        var content = mapper.content("owner-1", row);
        var serialized = content.toString();

        assertThat(content).containsEntry("externalId", "embedded-item")
                .containsEntry("text", "embedded text")
                .containsEntry("publishedAt", "2026-08-29T10:00:00.000Z");
        assertThat(content.get("canonicalUrl")).isEqualTo("https://example.test/post?id=1");
        assertThat(serialized).doesNotContain("xsec_token").doesNotContain("secret");
        @SuppressWarnings("unchecked")
        var source = (Map<String, Object>) content.get("source");
        assertThat(source).containsEntry("observationId", "observation-3");
    }
}
