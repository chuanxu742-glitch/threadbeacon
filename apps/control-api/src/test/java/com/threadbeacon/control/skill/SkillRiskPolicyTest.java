package com.threadbeacon.control.skill;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SkillRiskPolicyTest {
    private static final SkillElements ELEMENTS = SkillElements.from(Map.of(
            "procedure", List.of("search"),
            "terminal_conditions", List.of("results visible"),
            "red_lines", List.of("pay now", "export records")
    ));

    @Test
    void safeReadsRunWithoutConfirmation() {
        for (var verb : List.of("navigate", "scroll", "extract", "done")) {
            var decision = SkillRiskPolicy.classify(Map.of("verb", verb), Map.of(), ELEMENTS);
            assertThat(decision.needsConfirm()).as(verb).isFalse();
            assertThat(SkillRiskPolicy.canRun(decision, false)).isTrue();
        }
    }

    @Test
    void submitAndUnresolvedWritesNeedConfirmation() {
        var submit = SkillRiskPolicy.classify(
                Map.of("verb", "click", "ref", "9"),
                Map.of("role", "button", "name", "Submit order"), ELEMENTS);
        assertThat(submit.needsConfirm()).isTrue();
        assertThat(submit.reason()).contains("submit");

        var unresolved = SkillRiskPolicy.classify(
                Map.of("verb", "click", "ref", "missing"), Map.of(), ELEMENTS);
        assertThat(unresolved.reason()).isEqualTo("ambiguous-default-confirm");
    }

    @Test
    void redLineCannotBeBypassedByAutoConfirm() {
        var decision = SkillRiskPolicy.classify(
                Map.of("verb", "extract", "data", "export records"), Map.of(), ELEMENTS);
        assertThat(decision.matchedRedLine()).isEqualTo("export records");
        assertThat(SkillRiskPolicy.canRun(decision, true)).isFalse();
    }
}
