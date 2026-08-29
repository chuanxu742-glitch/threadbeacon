package com.threadbeacon.control.database;

import com.threadbeacon.control.skill.SkillService;
import com.threadbeacon.control.node.WorkerNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.DriverManager;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class PostgresMigrationConformanceTest {
    @Test
    void appliesEveryMigrationToAnEmptyPostgresDatabase() throws Exception {
        var url = System.getenv("TEST_DATABASE_URL_PG");
        assumeTrue(url != null && !url.isBlank(), "TEST_DATABASE_URL_PG is not configured");
        var user = value("TEST_DATABASE_USER_PG", "threadbeacon");
        var password = value("TEST_DATABASE_PASSWORD_PG", "threadbeacon-test");
        var flyway = Flyway.configure()
                .dataSource(url, user, password)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        try {
            flyway.clean();
            var result = flyway.migrate();
            assertThat(result.migrationsExecuted).isEqualTo(3);
            try (var connection = DriverManager.getConnection(url, user, password);
                 var statement = connection.prepareStatement("""
                         SELECT table_name FROM information_schema.tables
                         WHERE table_schema='public' AND table_type='BASE TABLE'
                           AND table_name <> 'flyway_schema_history'
                         """)) {
                var tables = new HashSet<String>();
                try (var rows = statement.executeQuery()) {
                    while (rows.next()) tables.add(rows.getString(1));
                }
                assertThat(tables).hasSize(40);
                assertThat(tables).contains(
                        "jobs", "workflows", "geo_acquisition_executions",
                        "skills", "skill_versions", "skill_runs",
                        "skill_run_events", "skill_evidence", "skill_corrections",
                        "skill_action_reviews");
            }
            verifiesTheGovernedSkillLifecycle(url, user, password);
        } finally {
            flyway.clean();
        }
    }

    @SuppressWarnings("unchecked")
    private static void verifiesTheGovernedSkillLifecycle(String url, String user, String password) {
        var dataSource = new DriverManagerDataSource(url, user, password);
        var jdbc = new JdbcTemplate(dataSource);
        var transactions = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        var service = new SkillService(jdbc, transactions, new ObjectMapper(), new SimpleMeterRegistry());
        var owner = "postgres-conformance";
        jdbc.update("""
                INSERT INTO nodes(id,name,token_hash,platform,version,capabilities_json,runtime_json,max_concurrency,status,active_jobs,last_seen_at,created_at)
                VALUES('skill-worker','skill-worker','hash','test','1','[\"agent-skill\"]','{}',1,'online',0,?,?)
                """, java.time.Instant.now().toString(), java.time.Instant.now().toString());
        var worker = new WorkerNode("skill-worker", List.of("agent-skill"), 0, 1);
        var elements = Map.<String, Object>of(
                "preconditions", List.of("public page is reachable"),
                "procedure", List.of("observe", "extract evidence"),
                "milestones", List.of("page observed"),
                "terminal_conditions", List.of("evidence captured"),
                "false_terminal_states", List.of("page loaded without evidence"),
                "recovery_policies", List.of("retry once"),
                "anti_drift_boundaries", List.of("remain on official domain"),
                "red_lines", List.of("never submit a form")
        );
        var skill = service.create(owner, Map.of(
                "domain", "example.com",
                "capability", "official-site.observe",
                "name", "Official site observer",
                "scope", "Read-only public page observation",
                "skillMd", "# Official site observer\n\nCapture grounded evidence.",
                "elements", elements
        ));
        var skillId = skill.get("id").toString();
        service.publish(owner, skillId);

        for (var attempt = 1; attempt <= 3; attempt++) {
            var run = service.startRun(owner, skillId, Map.of("task", "Observe the public product page"));
            var runId = run.get("id").toString();
            assertThat(service.claim(worker).get("id")).isEqualTo(runId);
            service.appendEvent(owner, runId, Map.of(
                    "sequence", 1,
                    "type", "action",
                    "payload", Map.of("kind", "navigate", "url", "https://example.com")
            ));
            var completed = service.completeRun(owner, runId, Map.of(
                    "loopOutcome", "capped",
                    "terminalConditionsHit", List.of(),
                    "detail", Map.of("attempt", attempt)
            ));
            assertThat(completed.get("status")).isEqualTo("failed");
        }

        var detail = service.get(owner, skillId);
        var corrections = (List<Map<String, Object>>) detail.get("corrections");
        assertThat(corrections).hasSize(1);
        assertThat(corrections.get(0).get("status")).isEqualTo("proposed");
        var correctionId = corrections.get(0).get("id").toString();

        var corrected = service.applyCorrection(owner, skillId, correctionId, Map.of(
                "expectedVersion", 1,
                "skillMd", "# Official site observer v2\n\nCapture grounded evidence with recovery.",
                "elements", elements
        ));
        assertThat(corrected.get("current_version")).isEqualTo(2);
        assertThat(service.rollback(owner, skillId, correctionId).get("current_version")).isEqualTo(1);

        detail = service.get(owner, skillId);
        assertThat((List<?>) detail.get("versions")).hasSize(2);
        assertThat((List<?>) detail.get("runs")).hasSize(3);
        assertThat((List<?>) detail.get("evidence")).hasSizeGreaterThanOrEqualTo(8);
    }

    private static String value(String key, String fallback) {
        var value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }
}
