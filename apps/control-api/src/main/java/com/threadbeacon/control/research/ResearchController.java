package com.threadbeacon.control.research;

import com.threadbeacon.control.common.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** v2 read and review endpoints for observations and findings. */
@RestController
@RequestMapping("/api/v2")
public class ResearchController {
    private final ResearchService research;
    private final CurrentUser user;

    public ResearchController(ResearchService research, CurrentUser user) {
        this.research = research;
        this.user = user;
    }

    @GetMapping("/projects/{projectId}/observations")
    public Map<String, Object> observations(@PathVariable String projectId,
                                             @RequestParam(defaultValue = "50") int limit,
                                             @RequestParam(defaultValue = "") String cursor) {
        user.requireScope("records:read");
        var page = research.observationsPage(user.ownerId(), projectId, limit, cursor);
        @SuppressWarnings("unchecked") var rows = (java.util.List<Map<String, Object>>) page.get("observations");
        page.put("items", rows);
        page.put("immutable", true);
        return page;
    }

    @GetMapping("/projects/{projectId}/findings")
    public Map<String, Object> findings(@PathVariable String projectId,
                                        @RequestParam(defaultValue = "50") int limit,
                                        @RequestParam(defaultValue = "") String cursor) {
        user.requireScope("records:read");
        var page = research.findingsPage(user.ownerId(), projectId, limit, cursor);
        @SuppressWarnings("unchecked") var rows = (java.util.List<Map<String, Object>>) page.get("findings");
        page.put("items", rows);
        return page;
    }

    @GetMapping("/findings/{findingId}")
    public Map<String, Object> finding(@PathVariable String findingId) {
        user.requireScope("records:read");
        return Map.of("finding", research.finding(user.ownerId(), findingId));
    }

    @GetMapping("/findings/{findingId}/revisions")
    public Map<String, Object> revisions(@PathVariable String findingId) {
        user.requireScope("records:read");
        return Map.of("revisions", research.revisions(user.ownerId(), findingId));
    }

    @PostMapping("/findings/{findingId}/reviews")
    public ResponseEntity<Map<String, Object>> review(@PathVariable String findingId,
                                                       @RequestBody Map<String, Object> body) {
        user.requireScope("records:read");
        user.requireRole("editor");
        var finding = research.review(user.ownerId(), user.userId(), findingId, body);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("finding", finding,
                "review", finding.get("review")));
    }
}
