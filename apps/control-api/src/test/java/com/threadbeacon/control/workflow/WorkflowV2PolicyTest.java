package com.threadbeacon.control.workflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class WorkflowV2PolicyTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void emptyDraftReturnsStructuredBlockingIssue() {
        var result = WorkflowV2Policy.validate(Map.of(), "owner", "project", null, mapper);
        assertThat(result.get("valid")).isEqualTo(false);
        assertThat(result.get("status")).isEqualTo("blocked");
        assertThat(result.get("readiness")).isEqualTo("blocked_by_policy");
        var issues = (List<?>) result.get("issues");
        assertThat(issues).isNotEmpty();
        assertThat(issues.get(0)).asString().doesNotContain("secret");
    }

    @Test
    void inlineSourceCanBeValidatedWithoutAWorker() {
        var spec = Map.<String, Object>of(
                "nodes", List.of(Map.of("id", "source-1", "type", "source",
                        "config", Map.of("platform", "rss", "keyword", "threadbeacon"))),
                "edges", List.of());
        var result = WorkflowV2Policy.validate(spec, "owner", "project", null, mapper);
        assertThat(result.get("valid")).isEqualTo(true);
        assertThat(result.get("readiness")).isEqualTo("ready");
    }

    @Test
    void compatibilityBlockedNodeCannotBePublished() {
        var spec = Map.<String, Object>of(
                "nodes", List.of(Map.of("id", "source-1", "type", "source",
                        "config", Map.of("platform", "rss", "blockedByCompatibility", true))),
                "edges", List.of());
        var result = WorkflowV2Policy.validate(spec, "owner", "project", null, mapper);
        assertThat(result.get("valid")).isEqualTo(false);
        assertThat((List<?>) result.get("issues")).extracting(Object::toString)
                .anyMatch(issue -> issue.contains("COMPATIBILITY_BLOCKED"));
    }
}
