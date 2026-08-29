package com.threadbeacon.control.skill;

import com.threadbeacon.control.common.ApiException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SkillElementsTest {
    @Test
    void parsesAndNormalizesTheGovernedElements() {
        var elements = SkillElements.from(Map.of(
                "procedure", List.of(" search ", "extract", "search"),
                "terminal_conditions", List.of("results visible"),
                "red_lines", List.of("delete account")
        ));

        assertThat(elements.procedure()).containsExactly("search", "extract");
        assertThat(elements.terminalConditions()).containsExactly("results visible");
        assertThat(elements.asMap()).containsKeys(
                "preconditions", "procedure", "milestones", "terminal_conditions",
                "false_terminal_states", "recovery_policies",
                "anti_drift_boundaries", "red_lines");
    }

    @Test
    void rejectsSkillsWithoutProcedureOrTerminalConditions() {
        assertThatThrownBy(() -> SkillElements.from(Map.of(
                "terminal_conditions", List.of("done"))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("procedure");
        assertThatThrownBy(() -> SkillElements.from(Map.of(
                "procedure", List.of("search"))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("terminal_conditions");
    }
}
