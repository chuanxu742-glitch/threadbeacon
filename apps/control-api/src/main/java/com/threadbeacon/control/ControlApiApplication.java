package com.threadbeacon.control;

import com.threadbeacon.control.config.ThreadBeaconProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableScheduling
@EnableAsync
@EnableConfigurationProperties(ThreadBeaconProperties.class)
public class ControlApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(ControlApiApplication.class, args);
    }
}
