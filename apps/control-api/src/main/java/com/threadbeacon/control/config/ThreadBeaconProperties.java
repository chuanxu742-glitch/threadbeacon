package com.threadbeacon.control.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "threadbeacon")
public record ThreadBeaconProperties(
        @Valid Auth auth,
        @Valid Node node,
        @Valid Encryption encryption,
        @Valid S3 s3
) {
    public record Auth(
            boolean localEnabled,
            @NotBlank String username,
            @Size(min = 16) String password,
            @NotBlank String userId,
            @NotBlank String email,
            @NotBlank String fullName
    ) {}

    public record Node(@Size(min = 16) String registrationKey) {}

    public record Encryption(@Size(min = 32) String key) {}

    public record S3(
            @NotBlank String endpoint,
            @NotBlank String accessKey,
            @Size(min = 8) String secretKey,
            @NotBlank String bucket
    ) {}
}
