package com.threadbeacon.control.workspace;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.CurrentUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.text;

/** Safe v2 projections for settings pages; secrets and token hashes never leave this boundary. */
@RestController
@RequestMapping("/api/v2")
public class WorkspaceSettingsV2Controller {
    private final JdbcTemplate jdbc;
    private final CurrentUser user;
    private final WorkspaceV2Service workspaces;
    private final ObjectMapper mapper;

    public WorkspaceSettingsV2Controller(JdbcTemplate jdbc, CurrentUser user,
                                         WorkspaceV2Service workspaces, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.user = user;
        this.workspaces = workspaces;
        this.mapper = mapper;
    }

    @GetMapping("/workspace/members")
    Map<String, Object> members() {
        V2Access.projectRead(user);
        var workspace = workspaces.currentWorkspace();
        var rows = jdbc.queryForList("""
                SELECT m.id,m.user_id,m.role,m.created_at,p.email,p.display_name
                FROM workspace_members m
                LEFT JOIN workspace_member_profiles p
                  ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id
                WHERE m.workspace_id=? ORDER BY m.created_at
                """, workspace.get("id"));
        var members = rows.stream().map(row -> {
            var item = new LinkedHashMap<String, Object>();
            item.put("id", row.get("id"));
            item.put("userId", row.get("user_id"));
            item.put("name", text(row.get("display_name")).isBlank() ? text(row.get("user_id")) : row.get("display_name"));
            item.put("email", row.get("email"));
            item.put("role", row.get("role"));
            item.put("status", "active");
            item.put("createdAt", row.get("created_at"));
            return item;
        }).toList();
        return Map.of("workspaceId", workspace.get("id"), "currentRole", user.role(), "members", members);
    }

    @GetMapping("/settings/developer")
    Map<String, Object> developer() {
        user.requireRole("owner");
        var rows = jdbc.queryForList("""
                SELECT id,name,role,scopes_json,token_prefix,last_used_at,expires_at,revoked_at,created_at
                FROM api_tokens WHERE owner_id=? ORDER BY created_at DESC LIMIT 100
                """, user.ownerId());
        var tokens = rows.stream().map(row -> {
            var item = new LinkedHashMap<String, Object>();
            item.put("id", row.get("id"));
            item.put("name", row.get("name"));
            item.put("type", "personal_access_token");
            item.put("role", row.get("role"));
            item.put("scopes", stringList(row.get("scopes_json")));
            item.put("prefix", row.get("token_prefix"));
            item.put("status", row.get("revoked_at") == null ? "active" : "revoked");
            item.put("lastUsedAt", row.get("last_used_at"));
            item.put("expiresAt", row.get("expires_at"));
            item.put("createdAt", row.get("created_at"));
            return item;
        }).toList();
        return Map.of("items", tokens, "tokens", tokens, "mcp", Map.of(
                "name", "threadbeacon",
                "protocolVersion", "2025-03-26",
                "transport", "streamable-http",
                "endpoint", "/api/mcp"));
    }

    @GetMapping("/settings/audit")
    Map<String, Object> audit(@RequestParam(defaultValue = "100") int limit,
                              @RequestParam(defaultValue = "") String cursor) {
        user.requireRole("owner");
        var bounded = Math.max(1, Math.min(200, limit));
        var offset = V2Cursor.offset(cursor);
        var rows = jdbc.queryForList("""
                SELECT id,action,resource_type,resource_id,detail_json,created_at
                FROM audit_logs WHERE owner_id=? ORDER BY created_at DESC,id DESC
                LIMIT ? OFFSET ?
                """, user.ownerId(), bounded + 1, offset);
        var hasMore = rows.size() > bounded;
        var events = new ArrayList<Map<String, Object>>();
        for (var row : rows.subList(0, Math.min(rows.size(), bounded))) {
            var item = new LinkedHashMap<String, Object>();
            item.put("id", row.get("id"));
            item.put("event", row.get("action"));
            item.put("type", row.get("resource_type"));
            item.put("resourceId", row.get("resource_id"));
            item.put("detail", object(row.get("detail_json")));
            item.put("status", "recorded");
            item.put("createdAt", row.get("created_at"));
            events.add(item);
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("events", events);
        result.put("items", events);
        result.put("limit", bounded);
        result.put("nextCursor", hasMore ? V2Cursor.next(offset + bounded) : null);
        return result;
    }

    private List<String> stringList(Object value) {
        try {
            return mapper.readValue(text(value), new TypeReference<List<String>>() { });
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private Map<String, Object> object(Object value) {
        try {
            return mapper.readValue(text(value), new TypeReference<Map<String, Object>>() { });
        } catch (Exception ignored) {
            return Map.of();
        }
    }
}
