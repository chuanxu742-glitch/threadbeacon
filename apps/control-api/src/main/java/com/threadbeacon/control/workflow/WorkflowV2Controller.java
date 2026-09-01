package com.threadbeacon.control.workflow;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2Access;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
public class WorkflowV2Controller {
    private final WorkflowV2Service workflows;
    private final CurrentUser user;

    public WorkflowV2Controller(WorkflowV2Service workflows, CurrentUser user) {
        this.workflows = workflows;
        this.user = user;
    }

    @GetMapping("/api/v2/projects/{projectId}/workflows")
    Map<String, Object> list(@PathVariable String projectId,
                             @RequestParam(defaultValue = "50") int limit,
                             @RequestParam(defaultValue = "") String cursor) {
        V2Access.workflowRead(user);
        return workflows.list(projectId, limit, cursor);
    }

    @PostMapping("/api/v2/projects/{projectId}/workflows")
    ResponseEntity<Map<String, Object>> create(@PathVariable String projectId, @RequestBody Map<String, Object> body) {
        V2Access.workflowWrite(user);
        user.requireRole("editor");
        return ResponseEntity.status(HttpStatus.CREATED).body(workflows.create(projectId, body));
    }

    @GetMapping("/api/v2/workflows/{workflowId}/draft")
    Map<String, Object> draft(@PathVariable String workflowId) {
        V2Access.workflowRead(user);
        return workflows.draft(workflowId);
    }

    @PutMapping("/api/v2/workflows/{workflowId}/draft")
    Map<String, Object> updateDraft(@PathVariable String workflowId, @RequestBody Map<String, Object> body) {
        V2Access.workflowWrite(user);
        user.requireRole("editor");
        return workflows.updateDraft(workflowId, body);
    }

    @PostMapping("/api/v2/workflows/{workflowId}/validate")
    Map<String, Object> validate(@PathVariable String workflowId,
                                 @RequestBody(required = false) Map<String, Object> body) {
        V2Access.workflowWrite(user);
        user.requireRole("editor");
        return workflows.validate(workflowId, body == null ? Map.of() : body);
    }

    @PostMapping("/api/v2/workflows/{workflowId}/publish")
    ResponseEntity<Map<String, Object>> publish(@PathVariable String workflowId,
                                                @RequestBody(required = false) Map<String, Object> body) {
        V2Access.workflowWrite(user);
        user.requireRole("editor");
        return ResponseEntity.ok(workflows.publish(workflowId, body == null ? Map.of() : body));
    }

    @GetMapping("/api/v2/workflows/{workflowId}/versions")
    Map<String, Object> versions(@PathVariable String workflowId,
                                 @RequestParam(defaultValue = "50") int limit,
                                 @RequestParam(defaultValue = "") String cursor) {
        V2Access.workflowRead(user);
        return workflows.versions(workflowId, limit, cursor);
    }
}
