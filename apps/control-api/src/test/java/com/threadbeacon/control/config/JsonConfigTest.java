package com.threadbeacon.control.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class JsonConfigTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner()
            .withUserConfiguration(JsonConfig.class);

    @Test
    void providesTheJackson2MapperUsedByTheApi() {
        context.run(applicationContext -> {
            assertThat(applicationContext).hasSingleBean(ObjectMapper.class);
            assertThat(applicationContext.getBean(ObjectMapper.class).writeValueAsString(
                    java.util.Map.of("status", "ok")))
                    .isEqualTo("{\"status\":\"ok\"}");
        });
    }
}
