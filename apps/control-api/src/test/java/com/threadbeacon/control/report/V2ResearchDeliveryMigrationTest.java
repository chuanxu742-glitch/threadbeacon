package com.threadbeacon.control.report;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/** Contract checks for the v2 research/delivery expand migration. */
class V2ResearchDeliveryMigrationTest {
    @Test
    void addsVersionedSnapshotsOperationsProjectionAndImmutabilityGuards() throws Exception {
        try (var stream = getClass().getResourceAsStream("/db/migration/V8__v2_research_delivery.sql")) {
            assertThat(stream).isNotNull();
            var sql = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            var matcher = Pattern.compile("CREATE TABLE(?: IF NOT EXISTS)? ([a-z_]+)", Pattern.CASE_INSENSITIVE)
                    .matcher(sql);
            var tables = new HashSet<String>();
            while (matcher.find()) tables.add(matcher.group(1).toLowerCase());
            assertThat(tables).containsExactlyInAnyOrder(
                    "finding_revisions", "report_drafts", "report_versions", "report_version_findings",
                    "delivery_operations", "delivery_attempts", "attention_items");
            assertThat(sql).contains(
                    "UNIQUE(finding_id, revision)",
                    "UNIQUE(project_id, version)",
                    "UNIQUE(owner_id, idempotency_key)",
                    "UNIQUE(operation_id, attempt)",
                    "observations_immutable",
                    "report_versions_immutable",
                    "report_version_findings_immutable",
                    "business_outcome_status",
                    "execution_result_json");
            assertThat(sql).doesNotContain("PRAGMA");
        }
    }
}
