package com.threadbeacon.control.social;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SocialV2PolicyTest {
    @Test
    void monitorConfigIsRecursivelySecretFree() {
        var sanitized = SocialV2Policy.sanitize(Map.of(
                "keywords", List.of("Razormind"),
                "credentials", Map.of("apiKey", "hidden", "region", "public"),
                "nested", List.of(Map.of("accessToken", "hidden", "safe", true))));

        assertThat(sanitized).containsKey("keywords").doesNotContainKey("credentials");
        assertThat(sanitized.get("nested").toString()).doesNotContain("accessToken").contains("safe");
    }

    @Test
    void keywordAndAccountWatchesUseNormalizedContent() {
        var content = Map.<String, Object>of(
                "platform", "youtube",
                "title", "Razormind launch",
                "content", "A public product update",
                "author", "@ThreadBeacon",
                "sourceItemId", "video-1");

        assertThat(SocialV2Policy.matches("keyword", "razormind", Map.of(), content)).isTrue();
        assertThat(SocialV2Policy.matches("account", "threadbeacon", Map.of(), content)).isTrue();
        assertThat(SocialV2Policy.matches("account", "other", Map.of(), content)).isFalse();
    }

    @Test
    void accountProjectionIdIsStableAndTenantScoped() {
        var first = SocialV2Policy.accountId("owner-a", "project-a", "rss", "Alice");
        assertThat(first).isEqualTo(SocialV2Policy.accountId("owner-a", "project-a", "rss", "alice"));
        assertThat(first).isNotEqualTo(SocialV2Policy.accountId("owner-b", "project-a", "rss", "alice"));
    }
}
