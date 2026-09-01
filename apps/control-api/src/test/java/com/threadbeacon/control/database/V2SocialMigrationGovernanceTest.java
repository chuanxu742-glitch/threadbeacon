package com.threadbeacon.control.database;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class V2SocialMigrationGovernanceTest {
    @Test
    void socialMigrationStoresOnlyMonitorsAndAlertState() throws Exception {
        var resource = getClass().getResourceAsStream("/db/migration/V9__v2_social_domain.sql");
        assertThat(resource).isNotNull();
        var sql = new String(resource.readAllBytes(), StandardCharsets.UTF_8);
        assertThat(sql).contains(
                "CREATE TABLE social_monitors",
                "monitor_type IN ('keyword','account','topic')",
                "CREATE TABLE social_alerts",
                "UNIQUE(owner_id,dedup_key)",
                "observation_id TEXT REFERENCES observations(id)");
        assertThat(sql).doesNotContain("CREATE TABLE social_content", "CREATE TABLE social_accounts", "PRAGMA");
    }
}
