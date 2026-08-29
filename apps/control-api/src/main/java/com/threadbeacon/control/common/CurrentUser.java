package com.threadbeacon.control.common;

import com.threadbeacon.control.access.AuthenticatedUser;
import com.threadbeacon.control.config.ThreadBeaconProperties;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Locale;
import java.util.Set;

@Component
public class CurrentUser {
    private final ThreadBeaconProperties properties;
    private final JdbcTemplate jdbc;

    public CurrentUser(ThreadBeaconProperties properties, JdbcTemplate jdbc) {
        this.properties = properties;
        this.jdbc = jdbc;
    }

    public String ownerId() {
        if (identity() != null) return identity().ownerId();
        var workspaceId=requestedWorkspaceId();
        if(!workspaceId.isBlank()){
            var memberships=jdbc.queryForList("SELECT w.owner_id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE w.id=? AND m.user_id=?",workspaceId,userId());
            if(!memberships.isEmpty())return String.valueOf(memberships.get(0).get("owner_id"));
        }
        return userId();
    }
    public String userId() { if(identity()!=null)return identity().ownerId();var oidc=oidc();return oidc==null?properties.auth().userId():"oidc:"+Values.hash(oidc.getIssuer()+"|"+oidc.getSubject()).substring(0,32); }
    public String email() { if (identity() != null) return identity().email(); var oidc=oidc(); return oidc==null?properties.auth().email():textOr(oidc.getEmail(),""); }
    public String displayName() { if (identity() != null) return identity().displayName(); var oidc=oidc(); return oidc==null?properties.auth().fullName():textOr(oidc.getFullName(),textOr(oidc.getPreferredUsername(),"OIDC User")); }
    public String role() {
        var identity = identity();
        if (identity != null) return identity.role();
        var stored = jdbc.queryForList("""
                SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
                WHERE m.user_id=? AND w.owner_id=? LIMIT 1
                """, userId(), ownerId());
        if (!stored.isEmpty()) return String.valueOf(stored.get(0).get("role"));
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null) {
            for (var authority : authentication.getAuthorities()) {
                if (authority.getAuthority().startsWith("ROLE_")) {
                    return authority.getAuthority().substring(5).toLowerCase(Locale.ROOT);
                }
            }
        }
        return "viewer";
    }
    public Set<String> scopes() { return identity() == null ? Set.of("*") : identity().scopes(); }
    public void requireRole(String required) {
        if (rank(role()) < rank(required)) throw new ApiException(HttpStatus.FORBIDDEN, "当前身份需要 " + required + " 权限");
    }
    public void requireScope(String scope) {
        if (!scopes().contains("*") && !scopes().contains(scope)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "API Token 缺少 scope：" + scope);
        }
    }

    private AuthenticatedUser identity() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getPrincipal() instanceof AuthenticatedUser value ? value : null;
    }
    private OidcUser oidc() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication != null && authentication.getPrincipal() instanceof OidcUser value ? value : null;
    }
    private String textOr(String value, String fallback) { return value == null || value.isBlank() ? fallback : value; }
    private String requestedWorkspaceId(){var attributes=RequestContextHolder.getRequestAttributes();if(!(attributes instanceof ServletRequestAttributes servlet))return "";var value=servlet.getRequest().getHeader("X-Workspace-Id");return value==null?"":value.trim();}
    private int rank(String role) {
        return switch (role) { case "owner" -> 3; case "editor" -> 2; default -> 1; };
    }
}
