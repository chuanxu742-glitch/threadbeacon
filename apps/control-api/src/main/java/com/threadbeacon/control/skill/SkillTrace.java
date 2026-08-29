package com.threadbeacon.control.skill;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

/** Pure journey_trace_v1 assembly and evaluation functions. */
public final class SkillTrace {
    public static final String SCHEMA = "journey_trace_v1";

    private SkillTrace() {}

    public static Map<String, Object> assemble(
            String traceId,
            String domain,
            String label,
            List<?> steps,
            Map<String, Object> outcome
    ) {
        var trace = new LinkedHashMap<String, Object>();
        trace.put("schema", SCHEMA);
        trace.put("trace_id", traceId);
        trace.put("label", label);
        trace.put("summary", Map.of("domain", domain));
        trace.put("steps", List.copyOf(steps));
        trace.put("outcome", Map.copyOf(outcome));
        return trace;
    }

    public static Map<String, Object> evaluate(
            String traceId,
            Map<String, Object> outcome,
            SkillElements elements
    ) {
        var status = text(outcome.get("status"));
        var loopOutcome = text(outcome.get("loop_outcome"));
        var succeeded = "success".equals(status);
        var declaredTerminals = elements.terminalConditions();
        var grounded = outcome.containsKey("terminal_conditions_hit");
        var terminalHits = strings(outcome.get("terminal_conditions_hit"));
        var terminalMet = succeeded && (!grounded || terminalHits.containsAll(declaredTerminals));

        var reportedMilestones = strings(outcome.get("milestones_hit"));
        var milestones = new ArrayList<String>();
        for (var item : reportedMilestones) {
            if (elements.milestones().isEmpty() || elements.milestones().contains(item)) milestones.add(item);
        }

        var evaluation = new LinkedHashMap<String, Object>();
        evaluation.put("event", "executed");
        evaluation.put("passed", succeeded && terminalMet);
        evaluation.put("terminal_met", terminalMet);
        evaluation.put("milestones_hit", milestones);
        evaluation.put("outcome", status.isBlank() ? "failed" : status);
        evaluation.put("loop_outcome", loopOutcome);
        evaluation.put("trace_id", traceId);
        evaluation.put("at", Instant.now().toString());
        return evaluation;
    }

    public static Map<String, Object> normalizeOutcome(Map<String, Object> input) {
        var loopOutcome = text(input.get("loopOutcome"));
        var status = switch (loopOutcome) {
            case "done_success" -> "success";
            case "awaiting_confirm" -> "paused";
            default -> "failed";
        };
        var result = new LinkedHashMap<String, Object>();
        result.put("status", status);
        result.put("loop_outcome", loopOutcome.isBlank() ? "error" : loopOutcome);
        result.put("milestones_hit", strings(input.get("milestonesHit")));
        result.put("terminal_conditions_hit", strings(input.get("terminalConditionsHit")));
        result.put("terminal_check", input.getOrDefault("terminalCheck", false));
        var detail = object(input.get("detail"));
        if (!detail.isEmpty()) result.put("detail", detail);
        return result;
    }

    private static List<String> strings(Object value) {
        if (!(value instanceof List<?> values)) return List.of();
        return values.stream().filter(String.class::isInstance).map(String.class::cast).map(String::trim).toList();
    }
}
