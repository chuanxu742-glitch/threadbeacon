package com.threadbeacon.control.capability;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2Access;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v2")
public class CapabilityV2Controller {
    private final CapabilityV2Service capabilities;
    private final CurrentUser user;

    public CapabilityV2Controller(CapabilityV2Service capabilities, CurrentUser user) {
        this.capabilities = capabilities;
        this.user = user;
    }

    @GetMapping("/capabilities/readiness")
    Map<String, Object> readiness() {
        V2Access.projectRead(user);
        return capabilities.readiness();
    }

    @GetMapping("/execution-resources")
    Map<String, Object> resources() {
        V2Access.projectRead(user);
        return Map.of("executionResources", capabilities.executionResources());
    }

    @GetMapping("/connections")
    Map<String, Object> connections() {
        V2Access.projectRead(user);
        return Map.of("connections", capabilities.connections());
    }
}
