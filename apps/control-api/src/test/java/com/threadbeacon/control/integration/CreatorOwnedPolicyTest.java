package com.threadbeacon.control.integration;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class CreatorOwnedPolicyTest {
    @Test
    void endpointRequiresScopeEncryptsGrantAndAuditsOnlyItsFingerprint() throws Exception {
        var source=java.nio.file.Files.readString(java.nio.file.Path.of("src/main/java/com/threadbeacon/control/integration/CreatorOwnedController.java"), StandardCharsets.UTF_8);
        assertThat(source).contains("requireScope(\"owned:fetch\")", "secrets.encrypt(grant)", "grantFingerprint", "audit_logs");
        assertThat(source).doesNotContain("json(mapper,Map.of(\"grantHandle\"");
    }
}
