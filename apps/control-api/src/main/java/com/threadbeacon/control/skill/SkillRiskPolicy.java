package com.threadbeacon.control.skill;

import java.util.List;
import java.util.Locale;
import java.util.Map;

import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

/**
 * Conservative write-before-confirm policy, adapted from opencli-Razormind's
 * Apache-2.0 risk classifier. This class is pure and browser independent.
 */
public final class SkillRiskPolicy {
    private static final List<String> AUTO_VERBS = List.of("navigate", "scroll", "extract", "done");
    private static final List<String> WRITE_VERBS = List.of("click", "type", "select");
    private static final List<String> HIGH_RISK = List.of("submit", "pay", "post", "delete");

    private SkillRiskPolicy() {}

    public static Decision classify(Map<String, Object> action, Map<String, Object> element, SkillElements skill) {
        var verb = text(action.get("verb")).toLowerCase(Locale.ROOT);
        var haystack = haystack(action, element);
        for (var redLine : skill.redLines()) {
            if (haystack.contains(redLine.toLowerCase(Locale.ROOT))) {
                return new Decision(Tier.CONFIRM, true, "red-line", redLine);
            }
        }
        var write = WRITE_VERBS.contains(verb);
        if (write && "type".equals(verb) && Boolean.TRUE.equals(action.get("submit"))) {
            return new Decision(Tier.CONFIRM, true, "submit-flag", null);
        }
        if (write) {
            for (var token : HIGH_RISK) {
                if (haystack.contains(token)) return new Decision(Tier.CONFIRM, true, "high-risk-verb:" + token, null);
            }
        }
        if (write && (element == null || element.isEmpty())) {
            return new Decision(Tier.CONFIRM, true, "ambiguous-default-confirm", null);
        }
        if (AUTO_VERBS.contains(verb) || write) return new Decision(Tier.AUTO, false, "auto:" + verb, null);
        return new Decision(Tier.CONFIRM, true, "ambiguous-default-confirm", null);
    }

    public static boolean canRun(Decision decision, boolean autoConfirm) {
        if (!decision.needsConfirm()) return true;
        if (decision.matchedRedLine() != null) return false;
        return autoConfirm;
    }

    private static String haystack(Map<String, Object> action, Map<String, Object> element) {
        var builder = new StringBuilder();
        for (var key : List.of("verb", "text", "url", "value", "note", "status", "data")) {
            var value = action.get(key);
            if (value != null) builder.append(' ').append(value);
        }
        var safeElement = element == null ? Map.<String, Object>of() : object(element);
        for (var key : List.of("name", "role", "value")) {
            var value = safeElement.get(key);
            if (value != null) builder.append(' ').append(value);
        }
        return builder.toString().toLowerCase(Locale.ROOT);
    }

    public enum Tier { AUTO, CONFIRM }
    public record Decision(Tier tier, boolean needsConfirm, String reason, String matchedRedLine) {}
}
