package com.threadbeacon.control.skill;

import com.threadbeacon.control.common.ApiException;
import org.springframework.http.HttpStatus;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.object;

/** Structured body of a reusable Skill. Scope is the ninth, general-pattern element. */
public record SkillElements(
        List<String> preconditions,
        List<String> procedure,
        List<String> milestones,
        List<String> terminalConditions,
        List<String> falseTerminalStates,
        List<String> recoveryPolicies,
        List<String> antiDriftBoundaries,
        List<String> redLines
) {
    public SkillElements {
        preconditions = List.copyOf(preconditions);
        procedure = List.copyOf(procedure);
        milestones = List.copyOf(milestones);
        terminalConditions = List.copyOf(terminalConditions);
        falseTerminalStates = List.copyOf(falseTerminalStates);
        recoveryPolicies = List.copyOf(recoveryPolicies);
        antiDriftBoundaries = List.copyOf(antiDriftBoundaries);
        redLines = List.copyOf(redLines);
        if (procedure.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Skill procedure 不能为空");
        }
        if (terminalConditions.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Skill terminal_conditions 不能为空");
        }
    }

    public static SkillElements from(Object value) {
        var input = object(value);
        return new SkillElements(
                stringList(input.get("preconditions")),
                stringList(input.get("procedure")),
                stringList(input.get("milestones")),
                stringList(input.get("terminal_conditions")),
                stringList(input.get("false_terminal_states")),
                stringList(input.get("recovery_policies")),
                stringList(input.get("anti_drift_boundaries")),
                stringList(input.get("red_lines"))
        );
    }

    public Map<String, Object> asMap() {
        var result = new LinkedHashMap<String, Object>();
        result.put("preconditions", preconditions);
        result.put("procedure", procedure);
        result.put("milestones", milestones);
        result.put("terminal_conditions", terminalConditions);
        result.put("false_terminal_states", falseTerminalStates);
        result.put("recovery_policies", recoveryPolicies);
        result.put("anti_drift_boundaries", antiDriftBoundaries);
        result.put("red_lines", redLines);
        return result;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> values)) return List.of();
        var result = values.stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .map(String::trim)
                .filter(item -> !item.isEmpty())
                .distinct()
                .toList();
        if (result.size() > 50 || result.stream().anyMatch(item -> item.length() > 1000)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Skill 九要素数量或长度超过限制");
        }
        return result;
    }
}
