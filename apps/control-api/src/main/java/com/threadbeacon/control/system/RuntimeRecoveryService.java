package com.threadbeacon.control.system;

import com.threadbeacon.control.platform.WorkflowRuntimeService;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static com.threadbeacon.control.common.Values.now;
import static com.threadbeacon.control.common.Values.text;

@Service
public class RuntimeRecoveryService {
    private final JdbcTemplate jdbc;
    private final WorkflowRuntimeService workflows;
    private final MeterRegistry metrics;

    public RuntimeRecoveryService(JdbcTemplate jdbc, WorkflowRuntimeService workflows, MeterRegistry metrics) {
        this.jdbc = jdbc; this.workflows = workflows; this.metrics = metrics;
    }

    @Scheduled(fixedDelayString = "${threadbeacon.recovery.scan-delay-ms:15000}")
    public void recover() {
        var timestamp = now();
        var offlineCutoff = Instant.now().minus(60, ChronoUnit.SECONDS).toString();
        var offline = jdbc.update("UPDATE nodes SET status='offline',active_jobs=0 WHERE status='online' AND last_seen_at<?", offlineCutoff);
        var expiredSessions = jdbc.update("""
                UPDATE browser_sessions SET status='closed',closed_at=?,updated_at=?,last_error='会话到期自动关闭'
                WHERE status NOT IN ('closed','closing') AND expires_at<?
                """, timestamp, timestamp, timestamp);
        var actionCutoff = Instant.now().minus(10, ChronoUnit.MINUTES).toString();
        var staleActions = jdbc.update("""
                UPDATE browser_actions SET status='failed',error='浏览器动作租约超时',finished_at=?
                WHERE status='running' AND started_at<?
                """, timestamp, actionCutoff);
        var expiredRuns = jdbc.queryForList("""
                SELECT id,workflow_run_id,workflow_node_id,attempt,max_attempts FROM skill_runs
                WHERE status='running' AND lease_expires_at<?
                """, timestamp);
        for (var run : expiredRuns) {
            var exhausted = ((Number) run.get("attempt")).intValue() >= ((Number) run.get("max_attempts")).intValue();
            jdbc.update("""
                    UPDATE skill_runs SET status=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
                      last_error='Agent Worker 租约过期',finished_at=?,updated_at=? WHERE id=? AND status='running'
                    """, exhausted ? "failed" : "queued", exhausted ? timestamp : null, timestamp, run.get("id"));
            if (exhausted) workflows.skillFinished(text(run.get("workflow_run_id")), text(run.get("workflow_node_id")), "failed",
                    java.util.Map.of("error", "Agent Worker 租约耗尽"));
        }
        var finalizerCutoff = Instant.now().minus(30, ChronoUnit.SECONDS).toString();
        for (var run : jdbc.queryForList("""
                SELECT r.id FROM workflow_runs r WHERE r.status IN ('finalizing','running') AND r.updated_at<?
                  AND NOT EXISTS(SELECT 1 FROM workflow_run_jobs j WHERE j.run_id=r.id AND j.status<>'completed')
                """, finalizerCutoff)) workflows.advance(text(run.get("id")));
        if (offline + expiredSessions + staleActions + expiredRuns.size() > 0) {
            metrics.counter("threadbeacon.recovery.actions", "kind", "runtime").increment(
                    offline + expiredSessions + staleActions + expiredRuns.size());
        }
    }
}
