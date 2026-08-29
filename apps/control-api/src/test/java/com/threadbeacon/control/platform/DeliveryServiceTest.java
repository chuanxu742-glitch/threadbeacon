package com.threadbeacon.control.platform;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DeliveryServiceTest {
    @Test
    void retriesTransientFailuresOnly() {
        assertThat(DeliveryService.retryable(null)).isTrue();
        assertThat(DeliveryService.retryable(408)).isTrue();
        assertThat(DeliveryService.retryable(429)).isTrue();
        assertThat(DeliveryService.retryable(503)).isTrue();
        assertThat(DeliveryService.retryable(400)).isFalse();
        assertThat(DeliveryService.retryable(404)).isFalse();
    }
}
