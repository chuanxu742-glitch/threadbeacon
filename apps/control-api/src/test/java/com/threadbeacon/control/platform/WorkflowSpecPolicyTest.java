package com.threadbeacon.control.platform;

import com.threadbeacon.control.common.ApiException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WorkflowSpecPolicyTest {
    @Test
    void acceptsAConnectedSkillDag() {
        WorkflowSpecPolicy.validate(Map.of(
                "nodes", List.of(
                        node("source", "source", Map.of("platform", "web")),
                        node("agent", "agent", Map.of("skillId", "skill-1")),
                        node("report", "report", Map.of())),
                "edges", List.of(edge("source", "agent"), edge("agent", "report"))));
    }

    @Test
    void rejectsCyclesAndUnboundAgents() {
        assertThatThrownBy(() -> WorkflowSpecPolicy.validate(Map.of(
                "nodes", List.of(node("source", "source", Map.of("platform", "web")), node("agent", "agent", Map.of())),
                "edges", List.of(edge("source", "agent")))))
                .isInstanceOf(ApiException.class).hasMessageContaining("绑定已发布 Skill");
        assertThatThrownBy(() -> WorkflowSpecPolicy.validate(Map.of(
                "nodes", List.of(node("source", "source", Map.of("platform", "web")), node("a", "report", Map.of()), node("b", "report", Map.of())),
                "edges", List.of(edge("source", "a"), edge("a", "b"), edge("b", "a")))))
                .isInstanceOf(ApiException.class).hasMessageContaining("循环依赖");
    }

    @Test
    void keepsCompatibilityBlocksOutOfPublishedVersions() {
        var spec = Map.<String,Object>of("nodes", List.of(
                node("source", "source", Map.of("platform", "web")),
                Map.of("id", "unsafe", "type", "gate", "label", "Dify code",
                        "config", Map.of("blockedByCompatibility", true))),
                "edges", List.of(edge("source", "unsafe")));
        WorkflowSpecPolicy.validate(spec);
        assertThatThrownBy(() -> WorkflowSpecPolicy.validateExecutable(spec))
                .isInstanceOf(ApiException.class).hasMessageContaining("兼容性审查阻断");
    }

    private Map<String, Object> node(String id, String type, Map<String, Object> config) {
        return Map.of("id", id, "type", type, "config", config);
    }
    private Map<String, Object> edge(String source, String target) {
        return Map.of("source", source, "target", target);
    }
}
