package com.threadbeacon.control.system;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class PlatformMetrics {
    public PlatformMetrics(JdbcTemplate jdbc, MeterRegistry registry) {
        gauge(registry, "threadbeacon.jobs.queued", jdbc, "SELECT count(*) FROM jobs WHERE status='queued'");
        gauge(registry, "threadbeacon.jobs.running", jdbc, "SELECT count(*) FROM jobs WHERE status='running'");
        gauge(registry, "threadbeacon.workflows.running", jdbc, "SELECT count(*) FROM workflow_runs WHERE status IN ('queued','running','finalizing')");
        gauge(registry, "threadbeacon.workflows.awaiting_confirmation", jdbc, "SELECT count(*) FROM workflow_runs WHERE status='awaiting_confirmation'");
        gauge(registry, "threadbeacon.skills.awaiting_confirmation", jdbc, "SELECT count(*) FROM skill_runs WHERE status='awaiting_confirmation'");
        gauge(registry, "threadbeacon.nodes.online", jdbc, "SELECT count(*) FROM nodes WHERE status='online'");
    }

    private void gauge(MeterRegistry registry, String name, JdbcTemplate jdbc, String sql) {
        Gauge.builder(name, jdbc, value -> {
            try { var count = value.queryForObject(sql, Long.class); return count == null ? 0 : count; }
            catch (Exception unavailable) { return Double.NaN; }
        }).register(registry);
    }
}
