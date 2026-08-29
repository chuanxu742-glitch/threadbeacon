package com.threadbeacon.control.skill;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SkillCorrectionPolicyTest {
    @Test
    void proposesAfterThreeConsecutiveSkillFailures() {
        var evidence = new ArrayList<Map<String, Object>>();
        evidence.add(failure("t1", "done_failed"));
        evidence.add(failure("noise", "error"));
        evidence.add(failure("t2", "capped"));
        evidence.add(failure("t3", "done_failed"));

        var result = SkillCorrectionPolicy.evaluate(evidence, 3);
        assertThat(result.required()).isTrue();
        assertThat(result.traceIds()).containsExactly("t1", "t2", "t3");
    }

    @Test
    void successAndCorrectionBoundariesResetTheStreak() {
        var success = List.of(
                failure("old", "done_failed"),
                Map.<String, Object>of("event_type", "executed", "passed", true,
                        "payload", Map.of("trace_id", "ok", "loop_outcome", "done_success")),
                failure("t1", "done_failed"), failure("t2", "done_failed")
        );
        assertThat(SkillCorrectionPolicy.evaluate(success, 3).required()).isFalse();

        var corrected = List.of(
                failure("old1", "done_failed"), failure("old2", "done_failed"),
                Map.<String, Object>of("event_type", "corrected", "payload", Map.of()),
                failure("t1", "done_failed"), failure("t2", "done_failed")
        );
        assertThat(SkillCorrectionPolicy.evaluate(corrected, 3).required()).isFalse();
    }

    private static Map<String, Object> failure(String traceId, String loopOutcome) {
        return Map.of(
                "event_type", "executed",
                "passed", false,
                "payload", Map.of("trace_id", traceId, "loop_outcome", loopOutcome)
        );
    }
}
