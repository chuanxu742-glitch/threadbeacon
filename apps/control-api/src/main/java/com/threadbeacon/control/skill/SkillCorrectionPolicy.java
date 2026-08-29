package com.threadbeacon.control.skill;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

/** Pure failure-streak policy. Infrastructure errors never teach a Skill the wrong lesson. */
public final class SkillCorrectionPolicy {
    private SkillCorrectionPolicy() {}

    public static Proposal evaluate(List<Map<String, Object>> evidence, int threshold) {
        var traceIds = new ArrayList<String>();
        for (var index = evidence.size() - 1; index >= 0; index--) {
            var entry = evidence.get(index);
            var event = text(entry.get("event_type"));
            if (List.of("corrected", "correction_dismissed", "correction_proposed", "rolled_back").contains(event)) break;
            if (!"executed".equals(event)) continue;
            var payload = object(entry.get("payload"));
            if ("error".equals(text(payload.get("loop_outcome")))) continue;
            if (Boolean.TRUE.equals(entry.get("passed")) || Boolean.TRUE.equals(payload.get("passed"))) break;
            var traceId = text(payload.get("trace_id"));
            if (!traceId.isBlank()) traceIds.add(0, traceId);
            if (traceIds.size() >= threshold) return new Proposal(true, List.copyOf(traceIds));
        }
        return new Proposal(false, List.of());
    }

    public record Proposal(boolean required, List<String> traceIds) {}
}
