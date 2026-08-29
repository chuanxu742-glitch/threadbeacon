package com.threadbeacon.control.common;

import com.threadbeacon.control.config.ThreadBeaconProperties;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecretBoxTest {
    @Test
    void encryptsWithAuthenticatedEncryption() throws Exception {
        var properties = new ThreadBeaconProperties(
                new ThreadBeaconProperties.Auth(true,"threadbeacon","1234567890123456","owner","owner@example.com","Owner"),
                new ThreadBeaconProperties.Node("1234567890123456"),
                new ThreadBeaconProperties.Encryption("12345678901234567890123456789012"),
                new ThreadBeaconProperties.S3("http://localhost:9000","threadbeacon","12345678","reports"));
        var box = new SecretBox(properties);
        var encrypted = box.encrypt("sensitive browser input");
        assertThat(encrypted).doesNotContain("sensitive");
        assertThat(box.decrypt(encrypted)).isEqualTo("sensitive browser input");
        var tampered = encrypted.substring(0, encrypted.length() - 1) + (encrypted.endsWith("A") ? "B" : "A");
        assertThatThrownBy(() -> box.decrypt(tampered)).isInstanceOf(IllegalStateException.class);
    }
}
