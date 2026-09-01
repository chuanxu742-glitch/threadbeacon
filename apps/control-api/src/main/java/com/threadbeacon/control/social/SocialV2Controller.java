package com.threadbeacon.control.social;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.workspace.V2Access;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Project-scoped social monitoring projections; no posting, commenting or DM endpoints. */
@RestController
@RequestMapping("/api/v2")
public class SocialV2Controller {
    private final MonitorApplicationService monitorsService;
    private final SocialProjectionQuery projections;
    private final SocialAlertService alertsService;
    private final CurrentUser user;

    public SocialV2Controller(MonitorApplicationService monitorsService, SocialProjectionQuery projections,
                              SocialAlertService alertsService, CurrentUser user) {
        this.monitorsService = monitorsService;
        this.projections = projections;
        this.alertsService = alertsService;
        this.user = user;
    }

    @GetMapping("/social/overview")
    public Map<String, Object> overview() {
        V2Access.socialRead(user);
        return projections.globalOverview();
    }

    @GetMapping("/social/alerts")
    public Map<String, Object> globalAlerts(@RequestParam(defaultValue = "open") String status,
                                            @RequestParam(defaultValue = "") String kind,
                                            @RequestParam(defaultValue = "") String search,
                                            @RequestParam(defaultValue = "50") int limit,
                                            @RequestParam(defaultValue = "") String cursor) {
        V2Access.socialRead(user);
        return alertsService.globalList(status, kind, search, limit, cursor);
    }

    @PostMapping("/social/alerts/refresh")
    public Map<String, Object> refreshGlobalAlerts() {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        alertsService.refreshGlobal();
        return Map.of("refreshed", true);
    }

    @GetMapping("/projects/{projectId}/social/overview")
    public Map<String, Object> projectOverview(@PathVariable String projectId) {
        V2Access.socialRead(user);
        return projections.projectOverview(projectId);
    }

    @GetMapping("/projects/{projectId}/social/monitors")
    public Map<String, Object> monitors(@PathVariable String projectId,
                                        @RequestParam(defaultValue = "") String status,
                                        @RequestParam(defaultValue = "") String type,
                                        @RequestParam(defaultValue = "") String search,
                                        @RequestParam(defaultValue = "50") int limit,
                                        @RequestParam(defaultValue = "") String cursor) {
        V2Access.socialRead(user);
        return monitorsService.list(projectId, status, type, search, limit, cursor);
    }

    @PostMapping("/projects/{projectId}/social/monitors")
    public ResponseEntity<Map<String, Object>> createMonitor(
            @PathVariable String projectId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody Map<String, Object> body) {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(monitorsService.create(projectId, body, idempotencyKey));
    }

    @GetMapping("/projects/{projectId}/social/monitors/{monitorId}")
    public Map<String, Object> monitor(@PathVariable String projectId, @PathVariable String monitorId) {
        V2Access.socialRead(user);
        return monitorsService.detail(projectId, monitorId);
    }

    @PatchMapping("/projects/{projectId}/social/monitors/{monitorId}")
    public Map<String, Object> updateMonitor(@PathVariable String projectId,
                                              @PathVariable String monitorId,
                                              @RequestBody Map<String, Object> body) {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        return monitorsService.update(projectId, monitorId, body);
    }

    @DeleteMapping("/projects/{projectId}/social/monitors/{monitorId}")
    public Map<String, Object> deleteMonitor(@PathVariable String projectId,
                                              @PathVariable String monitorId,
                                              @RequestParam(required = false) Integer revision) {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        return monitorsService.delete(projectId, monitorId, revision);
    }

    @PostMapping("/projects/{projectId}/social/monitors/{monitorId}/actions/{action}")
    public Map<String, Object> monitorAction(@PathVariable String projectId,
                                              @PathVariable String monitorId,
                                              @PathVariable String action,
                                              @RequestBody(required = false) Map<String, Object> body) {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        return monitorsService.action(projectId, monitorId, action, body == null ? Map.of() : body);
    }

    @GetMapping("/projects/{projectId}/social/content")
    public Map<String, Object> content(@PathVariable String projectId,
                                       @RequestParam(defaultValue = "") String search,
                                       @RequestParam(defaultValue = "") String platform,
                                       @RequestParam(defaultValue = "") String changeType,
                                       @RequestParam(defaultValue = "") String monitorId,
                                       @RequestParam(defaultValue = "50") int limit,
                                       @RequestParam(defaultValue = "") String cursor) {
        V2Access.socialRead(user);
        return projections.content(projectId, search, platform, changeType, monitorId, limit, cursor);
    }

    @GetMapping("/projects/{projectId}/social/accounts")
    public Map<String, Object> accounts(@PathVariable String projectId,
                                        @RequestParam(defaultValue = "") String search,
                                        @RequestParam(defaultValue = "") String platform,
                                        @RequestParam(defaultValue = "50") int limit,
                                        @RequestParam(defaultValue = "") String cursor) {
        V2Access.socialRead(user);
        return projections.accounts(projectId, search, platform, limit, cursor);
    }

    @GetMapping("/projects/{projectId}/social/insights")
    public Map<String, Object> insights(@PathVariable String projectId) {
        V2Access.socialRead(user);
        return projections.insights(projectId);
    }

    @GetMapping("/projects/{projectId}/social/alerts")
    public Map<String, Object> alerts(@PathVariable String projectId,
                                      @RequestParam(defaultValue = "open") String status,
                                      @RequestParam(defaultValue = "") String kind,
                                      @RequestParam(defaultValue = "") String search,
                                      @RequestParam(defaultValue = "") String monitorId,
                                      @RequestParam(defaultValue = "50") int limit,
                                      @RequestParam(defaultValue = "") String cursor) {
        V2Access.socialRead(user);
        return alertsService.list(projectId, status, kind, search, monitorId, limit, cursor);
    }

    @PostMapping("/projects/{projectId}/social/alerts/refresh")
    public Map<String, Object> refreshProjectAlerts(@PathVariable String projectId) {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        alertsService.refreshProject(projectId);
        return Map.of("projectId", projectId, "refreshed", true);
    }

    @PatchMapping("/projects/{projectId}/social/alerts/{alertId}")
    public Map<String, Object> updateAlert(@PathVariable String projectId,
                                            @PathVariable String alertId,
                                            @RequestBody Map<String, Object> body) {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        return alertsService.update(projectId, alertId, "", body);
    }

    @PostMapping("/projects/{projectId}/social/alerts/{alertId}/resolve")
    public Map<String, Object> resolveAlert(@PathVariable String projectId,
                                             @PathVariable String alertId,
                                             @RequestBody(required = false) Map<String, Object> body) {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        return alertsService.update(projectId, alertId, "resolve", body == null ? Map.of() : body);
    }

    @PostMapping("/projects/{projectId}/social/alerts/{alertId}/ignore")
    public Map<String, Object> ignoreAlert(@PathVariable String projectId,
                                            @PathVariable String alertId,
                                            @RequestBody(required = false) Map<String, Object> body) {
        V2Access.socialWrite(user);
        user.requireRole("editor");
        return alertsService.update(projectId, alertId, "ignore", body == null ? Map.of() : body);
    }
}
