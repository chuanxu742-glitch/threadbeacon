package com.threadbeacon.control.project;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2Access;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v2/projects")
public class ProjectV2Controller {
    private final ProjectV2Service projects;
    private final CurrentUser user;

    public ProjectV2Controller(ProjectV2Service projects, CurrentUser user) {
        this.projects = projects;
        this.user = user;
    }

    @GetMapping
    Map<String, Object> list(@RequestParam(defaultValue = "") String search,
                             @RequestParam(defaultValue = "") String status,
                             @RequestParam(defaultValue = "50") int limit,
                             @RequestParam(defaultValue = "") String cursor) {
        V2Access.projectRead(user);
        return projects.list(search, status, limit, cursor);
    }

    @PostMapping
    ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        V2Access.projectWrite(user);
        user.requireRole("editor");
        return ResponseEntity.status(HttpStatus.CREATED).body(projects.create(body));
    }

    @GetMapping("/{id}")
    Map<String, Object> get(@PathVariable String id) {
        V2Access.projectRead(user);
        return projects.detail(id);
    }

    @PatchMapping("/{id}")
    Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body) {
        V2Access.projectWrite(user);
        user.requireRole("editor");
        return projects.update(id, body);
    }

    @GetMapping("/{id}/readiness")
    Map<String, Object> readiness(@PathVariable String id) {
        V2Access.projectRead(user);
        return projects.readiness(id);
    }

    @GetMapping("/{id}/overview")
    Map<String, Object> overview(@PathVariable String id) {
        V2Access.projectRead(user);
        return projects.overview(id);
    }
}
