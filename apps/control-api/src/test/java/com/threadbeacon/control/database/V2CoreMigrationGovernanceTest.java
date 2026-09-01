package com.threadbeacon.control.database;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class V2CoreMigrationGovernanceTest {
    @Test
    void v2CoreMigrationAddsTenantSafeResourcesAndImmutableVersionMetadata() throws Exception {
        var resource = getClass().getResourceAsStream("/db/migration/V7__v2_core_domain.sql");
        assertThat(resource).isNotNull();
        var sql = new String(resource.readAllBytes(), StandardCharsets.UTF_8);
        assertThat(sql).contains(
                "CREATE TABLE connections",
                "CREATE TABLE execution_resources",
                "ALTER TABLE projects ADD COLUMN primary_workflow_id",
                "ALTER TABLE project_sources ADD COLUMN connection_id",
                "ALTER TABLE workflows ADD COLUMN status",
                "ALTER TABLE workflow_versions ADD COLUMN spec_hash",
                "ALTER TABLE workflow_runs ADD COLUMN idempotency_key",
                "workflow_versions_immutable");
        assertThat(sql).doesNotContain("PRAGMA");
    }
}
