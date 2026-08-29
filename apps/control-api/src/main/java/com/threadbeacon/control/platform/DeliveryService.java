package com.threadbeacon.control.platform;

import com.threadbeacon.control.common.SecretBox;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

@Service
public class DeliveryService {
    private final JdbcTemplate jdbc; private final SecretBox secrets; private final ObjectMapper mapper;
    private final MeterRegistry metrics;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    public DeliveryService(JdbcTemplate jdbc, SecretBox secrets, ObjectMapper mapper, MeterRegistry metrics) {
        this.jdbc=jdbc; this.secrets=secrets; this.mapper=mapper; this.metrics=metrics;
    }

    @Async
    public void deliver(String ownerId, String jobId, Map<String, Object> payload) {
        for (var rule : jdbc.queryForList("SELECT * FROM delivery_rules WHERE owner_id=? AND enabled=1", ownerId)) {
            var status="failed"; Integer responseCode=null; String error=null;
            try {
                var endpoint=URI.create(secrets.decrypt(text(rule.get("endpoint_encrypted"))));
                assertPublicHttps(endpoint);
                var body=mapper.writeValueAsString(Map.of("event","threadbeacon.job.completed","kind",rule.get("kind"),"jobId",jobId,"payload",payload));
                var response=client.send(HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(15))
                        .header("content-type","application/json").header("user-agent","threadbeacon-delivery/1.0")
                        .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.discarding());
                responseCode=response.statusCode(); status=responseCode>=200&&responseCode<300?"succeeded":"failed";
                if (!"succeeded".equals(status)) error="HTTP "+responseCode;
            } catch (Exception failure) { error=safeError(failure); }
            jdbc.update("INSERT INTO delivery_logs(id,owner_id,rule_id,job_id,status,response_code,error,created_at) VALUES(?,?,?,?,?,?,?,?)",
                    id(),ownerId,rule.get("id"),jobId,status,responseCode,error,now());
            metrics.counter("threadbeacon.deliveries", "status", status, "kind", text(rule.get("kind"))).increment();
        }
    }

    private void assertPublicHttps(URI endpoint) throws Exception {
        if (!"https".equalsIgnoreCase(endpoint.getScheme()) || endpoint.getHost()==null || endpoint.getUserInfo()!=null) throw new IllegalArgumentException("交付端点必须是公网 HTTPS");
        for (var address : InetAddress.getAllByName(endpoint.getHost())) {
            if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() ||
                    address.isSiteLocalAddress() || address.isMulticastAddress()) throw new IllegalArgumentException("交付端点解析到非公网地址");
        }
    }
    private String safeError(Exception error) {
        var value=error.getMessage()==null?error.getClass().getSimpleName():error.getMessage();
        var redacted=value.replaceAll("(?i)(token|key|secret)=[^&\\s]+","$1=[REDACTED]");
        return redacted.substring(0,Math.min(1000,redacted.length()));
    }
}
