package com.threadbeacon.control.job;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static com.threadbeacon.control.common.Values.hash;
import static com.threadbeacon.control.common.Values.json;

class JobServiceSocialHashTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void validSocialHashIgnoresPerFetchObservationMetadata() {
        var first = socialItem("2026-08-31T12:00:00.000Z", hex('a'));
        var second = socialItem("2026-08-31T12:05:00.000Z", hex('a'));

        var previous = JobService.contentHash(mapper, first);
        var current = JobService.contentHash(mapper, second);

        assertThat(current).isEqualTo(previous);
        assertThat(JobService.classifyChange(false, previous, current)).isEqualTo("unchanged");
    }

    @Test
    void invalidSocialHashFallsBackToFullItemHash() {
        var first = socialItem("2026-08-31T12:00:00.000Z", "not-a-sha256");
        var second = socialItem("2026-08-31T12:05:00.000Z", "not-a-sha256");

        var previous = JobService.contentHash(mapper, first);
        var current = JobService.contentHash(mapper, second);

        assertThat(previous).isEqualTo(hash(json(mapper, first)));
        assertThat(current).isEqualTo(hash(json(mapper, second)));
        assertThat(current).isNotEqualTo(previous);
        assertThat(JobService.classifyChange(false, previous, current)).isEqualTo("changed");
    }

    @Test
    void nonSocialItemDoesNotOptIntoSocialHashShortcut() {
        var first = socialItem("2026-08-31T12:00:00.000Z", hex('b'));
        var second = socialItem("2026-08-31T12:05:00.000Z", hex('b'));
        first.put("platform", "rss");
        second.put("platform", "rss");

        var previous = JobService.contentHash(mapper, first);
        var current = JobService.contentHash(mapper, second);

        assertThat(previous).isEqualTo(hash(json(mapper, first)));
        assertThat(current).isEqualTo(hash(json(mapper, second)));
        assertThat(current).isNotEqualTo(previous);
        assertThat(JobService.classifyChange(false, previous, current)).isEqualTo("changed");
    }

    private Map<String, Object> socialItem(String fetchedAt, String contentHash) {
        var item = new LinkedHashMap<String, Object>();
        item.put("platform", "youtube");
        item.put("id", "video-1");
        item.put("text", "same content");
        item.put("socialObservation", Map.of(
                "schema", "threadbeacon.social.observation.v1",
                "contentHash", contentHash,
                "observedAt", fetchedAt,
                "source", Map.of("fetchedAt", fetchedAt)));
        return item;
    }

    private String hex(char value) {
        return String.valueOf(value).repeat(64);
    }
}
