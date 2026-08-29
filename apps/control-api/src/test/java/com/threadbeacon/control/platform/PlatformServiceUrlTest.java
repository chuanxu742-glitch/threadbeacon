package com.threadbeacon.control.platform;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PlatformServiceUrlTest {
    @Test
    void acceptsOnlyTheDocumentedSourceUrlTemplates() {
        var uri = PlatformService.parsePublicUrl(
                "https://api.example.com/search?q={keyword}&limit={limit}");
        assertThat(uri.getHost()).isEqualTo("api.example.com");
        assertThat(uri.getQuery()).isEqualTo("q=threadbeacon&limit=1");

        assertThatThrownBy(() -> PlatformService.parsePublicUrl(
                "https://api.example.com/search?token={token}"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsLocalAndCredentialedUrls() {
        assertThatThrownBy(() -> PlatformService.parsePublicUrl("http://127.0.0.1/feed"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PlatformService.parsePublicUrl("https://user:secret@example.com/feed"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
