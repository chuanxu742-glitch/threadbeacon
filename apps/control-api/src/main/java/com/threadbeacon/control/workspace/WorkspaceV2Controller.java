package com.threadbeacon.control.workspace;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v2/me")
public class WorkspaceV2Controller {
    private final WorkspaceV2Service workspaces;

    public WorkspaceV2Controller(WorkspaceV2Service workspaces) {
        this.workspaces = workspaces;
    }

    @GetMapping("/context")
    Map<String, Object> context() {
        return workspaces.context();
    }
}
