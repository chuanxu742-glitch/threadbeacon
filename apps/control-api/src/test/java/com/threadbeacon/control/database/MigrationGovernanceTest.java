package com.threadbeacon.control.database;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class MigrationGovernanceTest {
    @Test
    void baselineContainsTheGovernedPlatformSchema() throws Exception {
        var resource = getClass().getResourceAsStream("/db/migration/V1__platform_baseline.sql");
        assertThat(resource).isNotNull();
        var sql = new String(resource.readAllBytes(), StandardCharsets.UTF_8);
        var matcher = Pattern.compile("CREATE TABLE ([a-z_]+)", Pattern.CASE_INSENSITIVE).matcher(sql);
        var tables = new java.util.HashSet<String>();
        while (matcher.find()) tables.add(matcher.group(1).toLowerCase());
        assertThat(tables).containsAll(Set.of("jobs","nodes","records","reports","workflows","workflow_runs","workflow_checkpoints","browser_profiles","browser_sessions","browser_actions","geo_acquisition_executions","audit_logs","api_tokens"));
        assertThat(tables).hasSize(33);
        assertThat(sql).doesNotContain("PRAGMA");
        assertThat(sql).contains("lease_owner TEXT", "lease_token TEXT", "lease_expires_at TEXT");
    }

    @Test
    void agentSkillMigrationUsesVersionedAuditableTables() throws Exception {
        var resource = getClass().getResourceAsStream("/db/migration/V2__agent_skill_governance.sql");
        assertThat(resource).isNotNull();
        var sql = new String(resource.readAllBytes(), StandardCharsets.UTF_8);
        var matcher = Pattern.compile("CREATE TABLE ([a-z_]+)", Pattern.CASE_INSENSITIVE).matcher(sql);
        var tables = new java.util.HashSet<String>();
        while (matcher.find()) tables.add(matcher.group(1).toLowerCase());
        assertThat(tables).containsExactlyInAnyOrder(
                "skills", "skill_versions", "skill_runs", "skill_run_events",
                "skill_evidence", "skill_corrections");
        assertThat(sql).contains(
                "UNIQUE(owner_id,domain,capability)",
                "UNIQUE(skill_id,version)",
                "UNIQUE(run_id,sequence)",
                "idx_skill_corrections_one_open");
        assertThat(sql).doesNotContain("PRAGMA");
    }

    @Test
    void agentRuntimeMigrationAddsLeasesReviewsAndTokenRoles() throws Exception {
        var resource = getClass().getResourceAsStream("/db/migration/V3__agent_runtime_and_access.sql");
        assertThat(resource).isNotNull();
        var sql = new String(resource.readAllBytes(), StandardCharsets.UTF_8);
        assertThat(sql).contains(
                "CREATE TABLE skill_action_reviews",
                "idx_skill_runs_workflow_node",
                "lease_expires_at TEXT",
                "ALTER TABLE api_tokens ADD COLUMN role");
        assertThat(sql).doesNotContain("PRAGMA");
    }
}
