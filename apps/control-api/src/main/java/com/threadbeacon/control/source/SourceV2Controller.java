package com.threadbeacon.control.source;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2Access;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v2/projects/{projectId}/sources")
public class SourceV2Controller {
    private final SourceV2Service sources;
    private final CurrentUser user;

    public SourceV2Controller(SourceV2Service sources, CurrentUser user) {
        this.sources = sources;
        this.user = user;
    }

    @GetMapping
    Map<String, Object> list(@PathVariable String projectId,
                             @RequestParam(defaultValue = "50") int limit,
                             @RequestParam(defaultValue = "") String cursor) {
        V2Access.sourceRead(user);
        return sources.list(projectId, limit, cursor);
    }

    @PostMapping
    ResponseEntity<Map<String, Object>> create(@PathVariable String projectId, @RequestBody Map<String, Object> body) {
        V2Access.sourceWrite(user);
        user.requireRole("editor");
        return ResponseEntity.status(HttpStatus.CREATED).body(sources.create(projectId, body));
    }

    @PostMapping("/{sourceId}/probe")
    ResponseEntity<Map<String, Object>> probe(@PathVariable String projectId, @PathVariable String sourceId) {
        V2Access.sourceWrite(user);
        user.requireRole("editor");
        return ResponseEntity.accepted().body(sources.probe(projectId, sourceId));
    }
}
