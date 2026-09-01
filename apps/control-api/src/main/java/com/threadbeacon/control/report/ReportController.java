package com.threadbeacon.control.report;

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

/** v2 report resources. A report id is a report version id once published. */
@RestController
@RequestMapping("/api/v2")
public class ReportController {
    private final ReportService reports;
    private final CurrentUser user;

    public ReportController(ReportService reports, CurrentUser user) {
        this.reports = reports;
        this.user = user;
    }

    @GetMapping("/projects/{projectId}/reports")
    public Map<String, Object> list(@PathVariable String projectId,
                                    @RequestParam(defaultValue = "50") int limit,
                                    @RequestParam(defaultValue = "") String cursor) {
        user.requireScope("records:read");
        return reports.reports(user.ownerId(), projectId, limit, cursor);
    }

    @PostMapping("/projects/{projectId}/report-drafts")
    public ResponseEntity<Map<String, Object>> createDraft(@PathVariable String projectId,
                                                             @RequestBody Map<String, Object> body) {
        user.requireScope("records:read");
        user.requireRole("editor");
        var draft = reports.createDraft(user.ownerId(), projectId, body);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("draft", draft));
    }

    @GetMapping("/report-drafts/{draftId}")
    public Map<String, Object> draft(@PathVariable String draftId) {
        user.requireScope("records:read");
        return Map.of("draft", reports.draft(user.ownerId(), draftId));
    }

    @PostMapping("/report-drafts/{draftId}/publish")
    public ResponseEntity<Map<String, Object>> publish(@PathVariable String draftId,
                                                        @RequestBody(required = false) Map<String, Object> body) {
        user.requireScope("records:read");
        user.requireRole("editor");
        var report = reports.publish(user.ownerId(), draftId, body == null ? Map.of() : body);
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("report", report,
                "reportVersion", report));
    }

    @GetMapping("/reports/{reportId}")
    public Map<String, Object> detail(@PathVariable String reportId) {
        user.requireScope("records:read");
        var report = reports.detail(user.ownerId(), reportId);
        return Map.of("report", report, "reportVersion", report);
    }
}
