package com.threadbeacon.control.run;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2Access;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
public class RunV2Controller {
    private final RunV2Service runs;
    private final CurrentUser user;

    public RunV2Controller(RunV2Service runs, CurrentUser user) {
        this.runs = runs;
        this.user = user;
    }

    @PostMapping("/api/v2/workflow-versions/{versionId}/runs")
    ResponseEntity<Map<String, Object>> create(@PathVariable String versionId,
                                               @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                               @RequestBody(required = false) Map<String, Object> body) {
        V2Access.runWrite(user);
        user.requireRole("editor");
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(runs.create(versionId, body == null ? Map.of() : body, key));
    }

    @GetMapping("/api/v2/projects/{projectId}/runs")
    Map<String, Object> list(@PathVariable String projectId,
                             @RequestParam(defaultValue = "") String status,
                             @RequestParam(defaultValue = "50") int limit,
                             @RequestParam(defaultValue = "") String cursor) {
        V2Access.runRead(user);
        return runs.list(projectId, status, limit, cursor);
    }

    @GetMapping("/api/v2/runs/{runId}")
    Map<String, Object> detail(@PathVariable String runId) {
        V2Access.runRead(user);
        return runs.detail(runId);
    }

    @GetMapping("/api/v2/runs/{runId}/events")
    Map<String, Object> events(@PathVariable String runId,
                               @RequestParam(defaultValue = "200") int limit,
                               @RequestParam(defaultValue = "") String cursor) {
        V2Access.runRead(user);
        return runs.events(runId, limit, cursor);
    }

    @PostMapping("/api/v2/runs/{runId}/actions/{action}")
    Map<String, Object> action(@PathVariable String runId, @PathVariable String action,
                               @RequestBody(required = false) Map<String, Object> body) {
        V2Access.runWrite(user);
        user.requireRole("editor");
        return runs.action(runId, action, body == null ? Map.of() : body);
    }
}
