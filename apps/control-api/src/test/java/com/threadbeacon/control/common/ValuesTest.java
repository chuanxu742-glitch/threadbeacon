package com.threadbeacon.control.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ValuesTest {
    @Test
    void hashesSecretsDeterministicallyWithoutKeepingPlaintext() {
        var digest = Values.hash("node-secret");
        assertThat(digest).hasSize(64).doesNotContain("node-secret").isEqualTo(Values.hash("node-secret"));
        assertThat(Values.constantTimeEquals(digest, Values.hash("node-secret"))).isTrue();
        assertThat(Values.constantTimeEquals(digest, Values.hash("other"))).isFalse();
    }
}
