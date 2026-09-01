package com.threadbeacon.control.platform;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.id;
import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

@Service
public class ProductEventService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ProductEventService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void track(String ownerId, String eventName, String projectId, String entityType, String entityId, Map<String, Object> properties) {
        try {
            jdbc.update("INSERT INTO product_events(id,owner_id,project_id,event_name,entity_type,entity_id,properties_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
                    id(), ownerId, blankToNull(projectId), eventName, entityType, blankToNull(entityId), mapper.writeValueAsString(properties == null ? Map.of() : properties), now());
        } catch (Exception ignored) {
            // Product telemetry must never make a successful research run fail.
        }
    }

    public Map<String, Object> metrics(String ownerId, String projectId) {
        var filter = projectId == null ? "" : projectId.trim();
        var rows = jdbc.queryForList("""
                SELECT event_name,count(*) AS count,max(created_at) AS last_at
                FROM product_events
                WHERE owner_id=? AND (?='' OR project_id=?)
                GROUP BY event_name ORDER BY event_name
                """, ownerId, filter, filter);
        var funnel = new LinkedHashMap<String, Object>();
        for (var name : List.of("workspace_ready", "project_created", "source_ready", "baseline_completed", "finding_reviewed", "report_delivered", "second_report_delivered")) {
            funnel.put(name, 0);
        }
        for (var row : rows) funnel.put(text(row.get("event_name")), row.get("count"));
        return Map.of("funnel", funnel, "events", rows);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
