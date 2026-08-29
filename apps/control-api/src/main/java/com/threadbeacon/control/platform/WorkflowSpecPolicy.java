package com.threadbeacon.control.platform;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.Values;
import org.springframework.http.HttpStatus;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.array;
import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

/** Pure structural validation for the published workflow DAG. */
public final class WorkflowSpecPolicy {
    private static final Set<String> TYPES = Set.of(
            "source", "normalize", "dedupe", "filter", "gate", "cluster", "llm",
            "agent", "report", "dataset", "deliver");

    private WorkflowSpecPolicy() {}

    public static void validate(Map<String, Object> spec) {
        var nodes = array(spec.get("nodes")).stream().map(Values::object).toList();
        var edges = array(spec.get("edges")).stream().map(Values::object).toList();
        if (nodes.isEmpty() || nodes.size() > 100) invalid("工作流节点数量必须是 1-100");
        var ids = new HashSet<String>();
        var types = new HashMap<String, String>();
        for (var node : nodes) {
            var id = text(node.get("id"));
            var type = text(node.get("type"));
            if (!id.matches("^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$") || !ids.add(id)) invalid("工作流节点 ID 无效或重复");
            if (!TYPES.contains(type)) invalid("工作流节点类型不受支持：" + type);
            if (type.equals("source") && text(object(node.get("config")).get("platform")).isBlank()) invalid("来源节点缺少 platform");
            if (type.equals("agent") && text(object(node.get("config")).get("skillId")).isBlank()) invalid("Agent 节点必须绑定已发布 Skill");
            types.put(id, type);
        }
        if (types.values().stream().noneMatch("source"::equals)) invalid("工作流至少需要一个来源节点");
        var outgoing = new HashMap<String, Set<String>>();
        var incoming = new HashMap<String, Integer>();
        ids.forEach(id -> { outgoing.put(id, new HashSet<>()); incoming.put(id, 0); });
        for (var edge : edges) {
            var source = text(edge.get("source")); var target = text(edge.get("target"));
            if (!ids.contains(source) || !ids.contains(target) || source.equals(target)) invalid("工作流连线引用了无效节点");
            if (outgoing.get(source).add(target)) incoming.put(target, incoming.get(target) + 1);
        }
        for (var id : ids) {
            if (types.get(id).equals("source") && incoming.get(id) != 0) invalid("来源节点不能有上游节点");
            if (!types.get(id).equals("source") && incoming.get(id) == 0) invalid("非来源节点必须连接上游节点：" + id);
        }
        var queue = new ArrayDeque<String>();
        var remaining = new HashMap<>(incoming);
        remaining.forEach((id, count) -> { if (count == 0) queue.add(id); });
        var visited = 0;
        while (!queue.isEmpty()) {
            var id = queue.remove(); visited++;
            for (var target : outgoing.get(id)) {
                var left = remaining.compute(target, (_key, value) -> value - 1);
                if (left == 0) queue.add(target);
            }
        }
        if (visited != nodes.size()) invalid("工作流存在循环依赖");
    }

    public static List<String> agentSkillIds(Map<String, Object> spec) {
        return array(spec.get("nodes")).stream().map(Values::object)
                .filter(node -> "agent".equals(text(node.get("type"))))
                .map(node -> text(object(node.get("config")).get("skillId"))).distinct().toList();
    }

    public static void validateExecutable(Map<String, Object> spec) {
        for (var raw : array(spec.get("nodes"))) {
            var node = object(raw);
            if (Boolean.TRUE.equals(object(node.get("config")).get("blockedByCompatibility"))) {
                throw new ApiException(HttpStatus.CONFLICT,
                        "节点 " + text(node.get("label")) + " 仍被兼容性审查阻断，不能发布");
            }
        }
    }

    private static void invalid(String message) {
        throw new ApiException(HttpStatus.BAD_REQUEST, message);
    }
}
