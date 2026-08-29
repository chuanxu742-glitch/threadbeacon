package com.threadbeacon.control.skill;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SkillTraceTest {
    private static final SkillElements ELEMENTS = SkillElements.from(Map.of(
            "procedure", List.of("search", "extract"),
            "milestones", List.of("results loaded"),
            "terminal_conditions", List.of("results visible")
    ));

    @Test
    void assemblesTheSharedTraceShape() {
        var trace = SkillTrace.assemble("t1", "example.com", "search",
                List.of(Map.of("type", "action")), Map.of("status", "success"));
        assertThat(trace.get("schema")).isEqualTo("journey_trace_v1");
        assertThat(trace.get("trace_id")).isEqualTo("t1");
        assertThat(trace).containsKeys("steps", "outcome", "summary", "label");
    }

    @Test
    void successMustBeGroundedInDeclaredTerminalConditions() {
        var accepted = SkillTrace.evaluate("t1", Map.of(
                "status", "success",
                "loop_outcome", "done_success",
                "terminal_conditions_hit", List.of("results visible"),
                "milestones_hit", List.of("results loaded")
        ), ELEMENTS);
        assertThat(accepted.get("passed")).isEqualTo(true);

        var ungrounded = SkillTrace.evaluate("t2", Map.of(
                "status", "success",
                "loop_outcome", "done_success",
                "terminal_conditions_hit", List.of()
        ), ELEMENTS);
        assertThat(ungrounded.get("passed")).isEqualTo(false);
    }

    @Test
    void mapsPausedAndFailedLoopOutcomes() {
        assertThat(SkillTrace.normalizeOutcome(Map.of("loopOutcome", "awaiting_confirm")))
                .containsEntry("status", "paused");
        assertThat(SkillTrace.normalizeOutcome(Map.of("loopOutcome", "capped")))
                .containsEntry("status", "failed");
    }
}
