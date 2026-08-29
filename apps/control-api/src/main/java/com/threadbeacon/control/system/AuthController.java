package com.threadbeacon.control.system;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.config.ThreadBeaconProperties;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final CurrentUser user;
    private final ThreadBeaconProperties properties;
    private final ObjectProvider<ClientRegistrationRepository> registrations;

    public AuthController(CurrentUser user, ThreadBeaconProperties properties,
                          ObjectProvider<ClientRegistrationRepository> registrations) {
        this.user = user;
        this.properties = properties;
        this.registrations = registrations;
    }

    @GetMapping("/methods")
    Map<String, Object> methods() {
        return Map.of(
                "local", properties.auth().localEnabled(),
                "oidc", registrations.getIfAvailable() != null,
                "oidcUrl", "/oauth2/authorization/threadbeacon"
        );
    }

    @GetMapping("/me")
    Map<String, Object> me() {
        return Map.of("displayName", user.displayName(), "email", user.email(), "role", user.role());
    }
}
