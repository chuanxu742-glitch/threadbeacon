package com.threadbeacon.control.access;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import static com.threadbeacon.control.common.Values.hash;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

@Component
public class PatAuthenticationFilter extends OncePerRequestFilter {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public PatAuthenticationFilter(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain
    ) throws ServletException, IOException {
        var authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.startsWith("Bearer threadbeacon_")) {
            chain.doFilter(request, response);
            return;
        }
        var token = authorization.substring(7);
        var rows = jdbc.queryForList("""
                SELECT id,owner_id,role,scopes_json,expires_at,revoked_at
                FROM api_tokens WHERE token_hash=?
                """, hash(token));
        if (rows.isEmpty() || rows.get(0).get("revoked_at") != null ||
                !Instant.parse(text(rows.get(0).get("expires_at"))).isAfter(Instant.now())) {
            unauthorized(response);
            return;
        }
        var row = rows.get(0);
        var role = text(row.get("role")).toLowerCase(Locale.ROOT);
        if (!Set.of("owner", "editor", "viewer").contains(role)) {
            unauthorized(response);
            return;
        }
        Set<String> scopes;
        try {
            scopes = Set.copyOf(mapper.readValue(text(row.get("scopes_json")), new TypeReference<List<String>>() {}));
        } catch (Exception malformed) {
            unauthorized(response);
            return;
        }
        var ownerId = text(row.get("owner_id"));
        var principal = new AuthenticatedUser(ownerId, "pat:" + row.get("id"), "", "API Token",
                role, scopes, text(row.get("id")));
        var authentication = new UsernamePasswordAuthenticationToken(
                principal, token, List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase(Locale.ROOT))));
        authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
        SecurityContextHolder.getContext().setAuthentication(authentication);
        jdbc.update("UPDATE api_tokens SET last_used_at=? WHERE id=?", now(), row.get("id"));
        chain.doFilter(request, response);
    }

    private void unauthorized(HttpServletResponse response) throws IOException {
        SecurityContextHolder.clearContext();
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json;charset=UTF-8");
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write("{\"error\":\"Bearer token 无效、已撤销或已过期\"}");
    }
}
