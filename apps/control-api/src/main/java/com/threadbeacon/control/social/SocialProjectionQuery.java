package com.threadbeacon.control.social;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.project.ProjectV2Service;
import com.threadbeacon.control.workspace.V2ApiException;
import com.threadbeacon.control.workspace.V2Cursor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

/** Read-side social projections over immutable observations and current records. */
@Service
public class SocialProjectionQuery {
    private final JdbcTemplate jdbc;
    private final ObjectMapper jsonMapper;
    private final CurrentUser user;
    private final ProjectV2Service projects;
    private final SocialRepository repository;
    private final SocialProjectionMapper mapper;

    public SocialProjectionQuery(JdbcTemplate jdbc, ObjectMapper jsonMapper, CurrentUser user, ProjectV2Service projects,
                                 SocialRepository repository, SocialProjectionMapper mapper) {
        this.jdbc = jdbc;
        this.jsonMapper = jsonMapper;
        this.user = user;
        this.projects = projects;
        this.repository = repository;
        this.mapper = mapper;
    }

    public Map<String, Object> globalOverview() {
        var ownerId = user.ownerId();
        var result = new LinkedHashMap<String, Object>();
        result.put("overview", overview(ownerId, ""));
        var monitors = repository.monitors(ownerId, "", 8, "", "", "").stream().map(this::monitor).toList();
        var items = pageContent(ownerId, "", "", "", "", 8, "").values();
        var accounts = pageAccounts(ownerId, "", "", "", 8, "").values();
        result.put("monitors", monitors);
        result.put("items", items);
        result.put("content", items);
        result.put("accounts", accounts);
        result.put("insights", insightsProjection(ownerId, ""));
        result.put("alerts", recentAlerts(ownerId, "", 8));
        result.put("nextCursor", null);
        return result;
    }

    public Map<String, Object> projectOverview(String projectId) {
        var ownerId = user.ownerId();
        var project = projects.project(ownerId, projectId);
        var result = new LinkedHashMap<String, Object>();
        result.put("overview", overview(ownerId, projectId));
        result.put("project", project);
        result.put("monitors", repository.monitors(ownerId, projectId, 8, "", "", "").stream().map(this::monitor).toList());
        var items = pageContent(ownerId, projectId, "", "", "", 8, "").values();
        result.put("items", items);
        result.put("content", items);
        result.put("accounts", pageAccounts(ownerId, projectId, "", "", 8, "").values());
        result.put("insights", insightsProjection(ownerId, projectId));
        result.put("alerts", recentAlerts(ownerId, projectId, 8));
        result.put("nextActions", nextActions(ownerId, projectId));
        result.put("nextCursor", null);
        return result;
    }

    public Map<String, Object> content(String projectId, String search, String platform, String changeType,
                                       String monitorId, int requestedLimit, String cursor) {
        var ownerId = user.ownerId();
        var scopedProject = projectId == null || projectId.isBlank() ? "" : projectId;
        if (!scopedProject.isBlank()) projects.project(ownerId, scopedProject);
        Map<String, Object> monitor = null;
        if (monitorId != null && !monitorId.isBlank()) {
            monitor = repository.monitor(ownerId, scopedProject, monitorId);
            if (monitor == null) throw notFound("SOCIAL_MONITOR_NOT_FOUND", "社媒监视器不存在");
        }
        validateChange(changeType);
        var limit = bounded(requestedLimit, 1, 500);
        var offset = V2Cursor.offset(cursor);
        final Map<String, Object> selectedMonitor = monitor;
        var values = repository.contentRows(ownerId, scopedProject, search, platform, changeType).stream()
                .map(row -> mapper.content(ownerId, row))
                .filter(value -> selectedMonitor == null || SocialV2Policy.matches(text(selectedMonitor.get("monitor_type")),
                        text(selectedMonitor.get("query")), SocialV2Policy.parseMap(selectedMonitor.get("config_json"), jsonMapper), value))
                .toList();
        var page = page(values, offset, limit);
        var result = new LinkedHashMap<String, Object>();
        if (!scopedProject.isBlank()) result.put("projectId", scopedProject);
        result.put("content", page.values()); result.put("contents", page.values()); result.put("items", page.values()); result.put("total", values.size());
        result.put("limit", limit); result.put("nextCursor", page.nextCursor());
        return result;
    }

    public Map<String, Object> accounts(String projectId, String search, String platform,
                                        int requestedLimit, String cursor) {
        var ownerId = user.ownerId();
        var scopedProject = projectId == null || projectId.isBlank() ? "" : projectId;
        if (!scopedProject.isBlank()) projects.project(ownerId, scopedProject);
        var limit = bounded(requestedLimit, 1, 500);
        var offset = V2Cursor.offset(cursor);
        var rows = repository.contentRows(ownerId, scopedProject, search, platform, "");
        var activeMonitors = repository.monitors(ownerId, scopedProject, 500, "active", "account", "");
        var grouped = new LinkedHashMap<String, Map<String, Object>>();
        for (var row : rows) {
            var projected = mapper.content(ownerId, row);
            var author = SocialV2Policy.authorText(projected.get("author")).trim();
            if (author.isBlank()) continue;
            var normalized = author.toLowerCase(Locale.ROOT).replaceFirst("^@", "");
            var key = text(row.get("platform")).toLowerCase(Locale.ROOT) + "|" + normalized;
            var account = grouped.computeIfAbsent(key, ignored -> account(ownerId, scopedProject, row, author, activeMonitors));
            account.put("contentCount", integer(account.get("contentCount"), 0) + 1);
            if (text(row.get("captured_at")).compareTo(text(account.get("latestSeenAt"))) > 0) {
                account.put("latestSeenAt", row.get("captured_at"));
                if (!text(projected.get("canonicalUrl")).isBlank()) account.put("url", projected.get("canonicalUrl"));
            }
        }
        var values = new ArrayList<>(grouped.values());
        values.sort(Comparator.comparingInt((Map<String, Object> value) -> integer(value.get("contentCount"), 0)).reversed()
                .thenComparing(value -> text(value.get("latestSeenAt")), Comparator.reverseOrder())
                .thenComparing(value -> text(value.get("id"))));
        var page = page(values, offset, limit);
        var result = new LinkedHashMap<String, Object>();
        if (!scopedProject.isBlank()) result.put("projectId", scopedProject);
        result.put("accounts", page.values()); result.put("items", page.values()); result.put("total", values.size());
        result.put("limit", limit); result.put("nextCursor", page.nextCursor());
        return result;
    }

    public Map<String, Object> insights(String projectId) {
        var ownerId = user.ownerId();
        projects.project(ownerId, projectId);
        return Map.of("projectId", projectId, "insights", insightsProjection(ownerId, projectId));
    }

    Map<String, Object> insightsProjection(String ownerId, String projectId) {
        var rows = repository.contentRows(ownerId, projectId, "", "", "");
        var byPlatform = new LinkedHashMap<String, Map<String, Object>>();
        var changes = new LinkedHashMap<String, Integer>();
        var activity = new LinkedHashMap<String, Integer>();
        var accounts = new LinkedHashMap<String, Map<String, Object>>();
        for (var row : rows) {
            var platform = text(row.get("platform"));
            var stats = byPlatform.computeIfAbsent(platform, ignored -> {
                var value = new LinkedHashMap<String, Object>();
                value.put("platform", platform); value.put("contentCount", 0); value.put("latestSeenAt", row.get("captured_at"));
                return value;
            });
            stats.put("contentCount", integer(stats.get("contentCount"), 0) + 1);
            if (text(row.get("captured_at")).compareTo(text(stats.get("latestSeenAt"))) > 0) stats.put("latestSeenAt", row.get("captured_at"));
            var change = text(row.get("change_type"));
            changes.put(change, changes.getOrDefault(change, 0) + 1);
            var captured = text(row.get("captured_at"));
            if (captured.length() >= 10) activity.put(captured.substring(0, 10), activity.getOrDefault(captured.substring(0, 10), 0) + 1);
            var projected = mapper.content(ownerId, row);
            var author = SocialV2Policy.authorText(projected.get("author"));
            if (!author.isBlank()) {
                var key = platform.toLowerCase(Locale.ROOT) + "|" + author.toLowerCase(Locale.ROOT);
                var account = accounts.computeIfAbsent(key, ignored -> account(ownerId, projectId, row, author, List.of()));
                account.put("contentCount", integer(account.get("contentCount"), 0) + 1);
            }
        }
        var platforms = new ArrayList<>(byPlatform.values());
        platforms.sort(Comparator.comparingInt((Map<String, Object> value) -> integer(value.get("contentCount"), 0)).reversed());
        var accountValues = new ArrayList<>(accounts.values());
        accountValues.sort(Comparator.comparingInt((Map<String, Object> value) -> integer(value.get("contentCount"), 0)).reversed());
        var activityValues = activity.entrySet().stream().sorted(Map.Entry.<String, Integer>comparingByKey().reversed())
                .map(entry -> Map.<String, Object>of("date", entry.getKey(), "contentCount", entry.getValue())).limit(30).toList();
        var result = new LinkedHashMap<String, Object>();
        if (!projectId.isBlank()) result.put("projectId", projectId);
        result.put("generatedAt", now()); result.put("totalContent", rows.size()); result.put("totalAccounts", accounts.size());
        result.put("byPlatform", platforms); result.put("changeTypes", changes); result.put("topAccounts", accountValues.stream().limit(20).toList());
        result.put("activity", activityValues); result.put("monitorCoverage", monitorCoverage(ownerId, projectId));
        result.put("alertSummary", alertSummary(ownerId, projectId));
        return result;
    }

    private Map<String, Object> overview(String ownerId, String projectId) {
        var result = new LinkedHashMap<String, Object>();
        result.put("scope", projectId.isBlank() ? "workspace" : "project");
        if (!projectId.isBlank()) result.put("projectId", projectId);
        var monitors = repository.countScoped("social_monitors", ownerId, projectId, "archived_at IS NULL");
        var active = repository.countScoped("social_monitors", ownerId, projectId, "archived_at IS NULL AND status='active'");
        var content = repository.countScoped("observations", ownerId, projectId, "");
        var accounts = repository.accountCount(ownerId, projectId);
        var openAlerts = repository.countScoped("social_alerts", ownerId, projectId, "status='open'");
        var allAlerts = repository.countScoped("social_alerts", ownerId, projectId, "");
        var latest = latest(ownerId, projectId);
        result.put("counts", Map.of("monitors", monitors, "activeMonitors", active, "content", content,
                "accounts", accounts, "openAlerts", openAlerts, "alerts", allAlerts));
        result.put("monitors", Map.of("total", monitors, "active", active));
        var contentStats = new LinkedHashMap<String, Object>();
        contentStats.put("total", content);
        contentStats.put("latestObservedAt", latest);
        result.put("content", contentStats);
        result.put("accounts", Map.of("total", accounts));
        result.put("alerts", Map.of("open", openAlerts, "total", allAlerts));
        result.put("topPlatforms", repository.topPlatforms(ownerId, projectId));
        result.put("lastObservedAt", latest); result.put("updatedAt", now());
        return result;
    }

    private List<Map<String, Object>> recentAlerts(String ownerId, String projectId, int limit) {
        return repository.alerts(ownerId, projectId, "open", "", "", "", limit, 0).stream().map(mapper::alert).toList();
    }

    private Map<String, Object> monitor(Map<String, Object> row) {
        return mapper.monitor(row, repository.alertCount(text(row.get("id")), ""), repository.alertCount(text(row.get("id")), "open"));
    }

    private Map<String, Object> account(String ownerId, String projectId, Map<String, Object> row, String author,
                                        List<Map<String, Object>> activeMonitors) {
        var projected = mapper.content(ownerId, row);
        var result = new LinkedHashMap<String, Object>();
        result.put("id", SocialV2Policy.accountId(ownerId, projectId, text(row.get("platform")), author));
        if (!projectId.isBlank()) result.put("projectId", projectId);
        result.put("platform", row.get("platform")); result.put("handle", author.startsWith("@") ? author : "@" + author);
        result.put("displayName", author); result.put("contentCount", 0); result.put("latestSeenAt", row.get("captured_at"));
        result.put("url", projected.get("canonicalUrl"));
        result.put("monitored", activeMonitors.stream().anyMatch(monitor -> SocialV2Policy.matches("account",
                text(monitor.get("query")), SocialV2Policy.parseMap(monitor.get("config_json"), jsonMapper),
                projected)));
        return result;
    }

    private Page pageContent(String ownerId, String projectId, String search, String platform, String changeType,
                             int limit, String cursor) {
        var values = repository.contentRows(ownerId, projectId, search, platform, changeType).stream()
                .map(row -> mapper.content(ownerId, row)).toList();
        return page(values, V2Cursor.offset(cursor), limit);
    }

    private Page pageAccounts(String ownerId, String projectId, String search, String platform,
                              int limit, String cursor) {
        var rows = repository.contentRows(ownerId, projectId, search, platform, "");
        var active = repository.monitors(ownerId, projectId, 500, "active", "account", "");
        var grouped = new LinkedHashMap<String, Map<String, Object>>();
        for (var row : rows) {
            var projected = mapper.content(ownerId, row);
            var author = SocialV2Policy.authorText(projected.get("author"));
            if (author.isBlank()) continue;
            var key = text(row.get("platform")).toLowerCase(Locale.ROOT) + "|" + author.toLowerCase(Locale.ROOT);
            var account = grouped.computeIfAbsent(key, ignored -> account(ownerId, projectId, row, author, active));
            account.put("contentCount", integer(account.get("contentCount"), 0) + 1);
        }
        var values = new ArrayList<>(grouped.values());
        values.sort(Comparator.comparingInt((Map<String, Object> value) -> integer(value.get("contentCount"), 0)).reversed());
        return page(values, V2Cursor.offset(cursor), limit);
    }

    private Map<String, Object> monitorCoverage(String ownerId, String projectId) {
        var rows = jdbc.queryForList("""
                SELECT status,count(*) AS count FROM social_monitors
                WHERE %s AND archived_at IS NULL GROUP BY status ORDER BY status
                """.formatted(repository.scopeClause("social_monitors", projectId)), repository.scopeArgs(ownerId, projectId));
        var result = new LinkedHashMap<String, Object>();
        for (var row : rows) result.put(text(row.get("status")), row.get("count"));
        result.putIfAbsent("active", 0);
        return result;
    }

    private Map<String, Object> alertSummary(String ownerId, String projectId) {
        var rows = jdbc.queryForList("""
                SELECT status,count(*) AS count FROM social_alerts
                WHERE %s GROUP BY status ORDER BY status
                """.formatted(repository.scopeClause("social_alerts", projectId)), repository.scopeArgs(ownerId, projectId));
        var result = new LinkedHashMap<String, Object>();
        for (var row : rows) result.put(text(row.get("status")), row.get("count"));
        result.putIfAbsent("open", 0);
        return result;
    }

    private String latest(String ownerId, String projectId) { return repository.latestObservedAt(ownerId, projectId); }
    private void validateChange(String value) {
        if (value != null && !value.isBlank() && !Set.of("baseline", "new", "changed", "unchanged").contains(value.trim())) {
            throw new V2ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "INVALID_CHANGE_TYPE", "changeType 无效");
        }
    }

    private List<String> nextActions(String ownerId, String projectId) {
        var result = new ArrayList<String>();
        if (repository.countScoped("social_monitors", ownerId, projectId, "archived_at IS NULL") == 0) result.add("create_monitor");
        if (repository.countScoped("observations", ownerId, projectId, "") == 0) result.add("run_workflow");
        if (repository.countScoped("social_alerts", ownerId, projectId, "status='open'") > 0) result.add("review_alerts");
        return result;
    }

    private Page page(List<Map<String, Object>> values, int offset, int limit) {
        var start = Math.min(Math.max(0, offset), values.size());
        var end = Math.min(values.size(), start + limit);
        return new Page(values.subList(start, end), end < values.size() ? V2Cursor.next(end) : null);
    }

    private record Page(List<Map<String, Object>> values, String nextCursor) {}
    private int bounded(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private V2ApiException notFound(String code, String message) { return new V2ApiException(org.springframework.http.HttpStatus.NOT_FOUND, code, message); }
}
