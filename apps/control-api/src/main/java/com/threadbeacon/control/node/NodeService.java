package com.threadbeacon.control.node;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.config.ThreadBeaconProperties;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.*;

@Service
public class NodeService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ThreadBeaconProperties properties;
    private final SecureRandom random = new SecureRandom();

    public NodeService(JdbcTemplate jdbc, ObjectMapper mapper, ThreadBeaconProperties properties) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.properties = properties;
    }

    public Map<String, Object> register(HttpServletRequest request, Map<String, Object> body) {
        if (!constantTimeEquals(request.getHeader("x-threadbeacon-registration-key") == null ? "" : request.getHeader("x-threadbeacon-registration-key"), properties.node().registrationKey())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "节点注册密钥无效");
        }
        var name = text(body.get("name"));
        if (name.isBlank() || name.length() > 80) throw new ApiException(HttpStatus.BAD_REQUEST, "节点名称长度必须是 1-80 个字符");
        var tokenBytes = new byte[32]; random.nextBytes(tokenBytes);
        var token = "node_" + HexFormat.of().formatHex(tokenBytes);
        var nodeId = jdbc.query("SELECT id FROM nodes WHERE name=?", rs -> rs.next() ? rs.getString(1) : id(), name);
        var capabilities = strings(body.get("capabilities"));
        var concurrency = Math.max(1, Math.min(64, integer(body.get("maxConcurrency"), 1)));
        var runtime = json(mapper, body.getOrDefault("runtime", Map.of()));
        var timestamp = now();
        jdbc.update("""
            INSERT INTO nodes(id,name,token_hash,platform,version,capabilities_json,runtime_json,max_concurrency,status,active_jobs,last_seen_at,created_at)
            VALUES(?,?,?,?,?,?,?,?,'online',0,?,?)
            ON CONFLICT(name) DO UPDATE SET token_hash=excluded.token_hash,platform=excluded.platform,version=excluded.version,
            capabilities_json=excluded.capabilities_json,runtime_json=excluded.runtime_json,max_concurrency=excluded.max_concurrency,
            status='online',last_seen_at=excluded.last_seen_at
            """, nodeId, name, hash(token), text(body.get("platform")), text(body.get("version")), json(mapper, capabilities), runtime, concurrency, timestamp, timestamp);
        return Map.of("node", Map.of("id", nodeId, "name", name), "token", token);
    }

    public WorkerNode authenticate(HttpServletRequest request, Map<String, Object> body) {
        var nodeId = text(body.get("nodeId"));
        if (nodeId.isBlank()) nodeId = request.getHeader("x-threadbeacon-node-id") == null ? "" : request.getHeader("x-threadbeacon-node-id").trim();
        var authorization = request.getHeader("authorization");
        var token = authorization != null && authorization.startsWith("Bearer ") ? authorization.substring(7) : "";
        if (nodeId.isBlank() || token.isBlank()) throw new ApiException(HttpStatus.UNAUTHORIZED, "缺少 Worker 身份");
        var rows = jdbc.queryForList("SELECT id,token_hash,capabilities_json,active_jobs,max_concurrency FROM nodes WHERE id=?", nodeId);
        if (rows.isEmpty() || !constantTimeEquals(hash(token), text(rows.get(0).get("token_hash")))) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Worker 身份无效");
        }
        try {
            var capabilities = mapper.readValue(text(rows.get(0).get("capabilities_json")), new TypeReference<List<String>>() {});
            return new WorkerNode(nodeId, capabilities, integer(rows.get(0).get("active_jobs"), 0), integer(rows.get(0).get("max_concurrency"), 1));
        } catch (Exception error) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Worker 能力数据损坏");
        }
    }

    public void heartbeat(WorkerNode node, Map<String, Object> body) {
        var timestamp = now();
        var capabilities = body.containsKey("capabilities") ? strings(body.get("capabilities")) : node.capabilities();
        jdbc.update("""
            UPDATE nodes SET active_jobs=?,status='online',last_seen_at=?,capabilities_json=?,health_json=?,runtime_json=?,max_concurrency=? WHERE id=?
            """, Math.max(0, integer(body.get("activeJobs"), 0)), timestamp, json(mapper, capabilities),
                json(mapper, body.getOrDefault("health", Map.of())), json(mapper, body.getOrDefault("runtime", Map.of())),
                Math.max(1, Math.min(64, integer(body.get("maxConcurrency"), node.maxConcurrency()))), node.id());
        jdbc.update("UPDATE geo_acquisition_executions SET heartbeat_at=?,lease_expires_at=?,updated_at=? WHERE lease_owner=? AND status='running'",
                timestamp, Instant.now().plus(30, ChronoUnit.SECONDS).toString(), timestamp, node.id());
        jdbc.update("UPDATE skill_runs SET lease_expires_at=?,updated_at=? WHERE lease_owner=? AND status='running'",
                Instant.now().plus(60, ChronoUnit.SECONDS).toString(), timestamp, node.id());
        persistAttestation(node.id(), object(body.get("runtime")), timestamp);
    }

    private void persistAttestation(String nodeId, Map<String, Object> runtime, String timestamp) {
        var attestation = object(runtime.get("browserAttestation"));
        var profileName = text(attestation.get("profileName"));
        var profileKind = text(attestation.get("profileKind"));
        if (profileName.isBlank() || profileKind.isBlank()) return;
        jdbc.update("""
            UPDATE browser_profiles SET node_id=?,status=?,attestation_json=?,last_verified_at=?,updated_at=?
            WHERE profile_name=? AND profile_kind=?
            """, nodeId, Boolean.TRUE.equals(attestation.get("verified")) ? "verified" : "unverified",
                json(mapper, attestation), timestamp, timestamp, profileName, profileKind);
    }

    public List<Map<String, Object>> list() {
        return jdbc.queryForList("SELECT id,name,platform,version,capabilities_json,runtime_json,health_json,transport_mode,max_concurrency,status,active_jobs,last_seen_at,created_at FROM nodes ORDER BY last_seen_at DESC LIMIT 100");
    }

    public boolean geoReady() {
        var cutoff = Instant.now().minus(20, ChronoUnit.SECONDS).toString();
        return jdbc.queryForList("SELECT capabilities_json,runtime_json FROM nodes WHERE status='online' AND last_seen_at>=?", cutoff)
                .stream().anyMatch(this::isReadyGeoNode);
    }

    private boolean isReadyGeoNode(Map<String, Object> row) {
        try {
            var capabilities = mapper.readValue(text(row.get("capabilities_json")), new TypeReference<List<String>>() {});
            if (!capabilities.contains("geo")) return false;
            var runtime = mapper.readValue(text(row.get("runtime_json")), new TypeReference<Map<String, Object>>() {});
            var attestation = object(runtime.get("browserAttestation"));
            return Boolean.TRUE.equals(runtime.get("browserEndpointConfigured"))
                    && Boolean.TRUE.equals(attestation.get("verified"))
                    && "anonymous".equals(text(attestation.get("profileKind")))
                    && Instant.parse(text(attestation.get("expiresAt"))).isAfter(Instant.now());
        } catch (Exception ignored) {
            return false;
        }
    }
}
