package com.threadbeacon.control.automation;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2Access;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v2/automations")
public class AutomationV2Controller {
    private final AutomationV2Service automations;
    private final CurrentUser user;

    public AutomationV2Controller(AutomationV2Service automations, CurrentUser user) {
        this.automations = automations;
        this.user = user;
    }

    @GetMapping
    Map<String, Object> list() {
        V2Access.workflowRead(user);
        return automations.list(user.ownerId());
    }
}
