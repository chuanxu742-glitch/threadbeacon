package com.threadbeacon.control.skill;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.platform.WorkflowRuntimeService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

import static com.threadbeacon.control.common.Values.bool;
import static com.threadbeacon.control.common.Values.object;

@RestController
@RequestMapping("/api/skills")
public class SkillController {
    private final SkillService skills;
    private final CurrentUser user;
    private final WorkflowRuntimeService workflowRuntime;

    public SkillController(SkillService skills, CurrentUser user, WorkflowRuntimeService workflowRuntime) {
        this.skills = skills;
        this.user = user;
        this.workflowRuntime = workflowRuntime;
    }

    @GetMapping
    Map<String, Object> list() {
        user.requireScope("skills:read");
        return Map.of("skills", skills.list(user.ownerId()));
    }

    @PostMapping
    ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        user.requireScope("skills:run");
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(Map.of("skill", skills.create(user.ownerId(), body)));
    }

    @GetMapping("/{id}")
    Map<String, Object> get(@PathVariable String id) {
        user.requireScope("skills:read");
        return skills.get(user.ownerId(), id);
    }

    @PostMapping("/{id}/publish")
    Map<String, Object> publish(@PathVariable String id) {
        user.requireScope("skills:run");
        return Map.of("skill", skills.publish(user.ownerId(), id));
    }

    @PostMapping("/{id}/runs")
    ResponseEntity<Map<String, Object>> startRun(
            @PathVariable String id,
            @RequestBody Map<String, Object> body
    ) {
        user.requireScope("skills:run");
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(Map.of("run", skills.startRun(user.ownerId(), id, body)));
    }

    @GetMapping("/runs/{runId}")
    Map<String, Object> run(@PathVariable String runId) {
        user.requireScope("runs:read");
        return Map.of("run", skills.run(user.ownerId(), runId));
    }

    @PostMapping("/runs/{runId}/events")
    Map<String, Object> event(
            @PathVariable String runId,
            @RequestBody Map<String, Object> body
    ) {
        user.requireScope("skills:run");
        return skills.appendEvent(user.ownerId(), runId, body);
    }

    @PostMapping("/runs/{runId}/complete")
    Map<String, Object> complete(
            @PathVariable String runId,
            @RequestBody Map<String, Object> body
    ) {
        user.requireScope("skills:run");
        var run = skills.completeRun(user.ownerId(), runId, body);
        workflowRuntime.skillFinished(value(run, "workflow_run_id"), value(run, "workflow_node_id"), value(run, "status"), run);
        return Map.of("run", run);
    }

    @PostMapping("/runs/{runId}/reviews/{reviewId}/approve")
    Map<String, Object> approve(@PathVariable String runId, @PathVariable String reviewId) {
        user.requireScope("skills:run");
        var run = skills.resolveReview(user.ownerId(), runId, reviewId, true);
        workflowRuntime.skillResumed(value(run, "workflow_run_id"));
        return Map.of("run", run);
    }

    @PostMapping("/runs/{runId}/reviews/{reviewId}/reject")
    Map<String, Object> reject(@PathVariable String runId, @PathVariable String reviewId) {
        user.requireScope("skills:run");
        var run = skills.resolveReview(user.ownerId(), runId, reviewId, false);
        workflowRuntime.skillFinished(value(run, "workflow_run_id"), value(run, "workflow_node_id"), value(run, "status"), run);
        return Map.of("run", run);
    }

    @PostMapping("/{skillId}/corrections/{correctionId}/apply")
    Map<String, Object> apply(
            @PathVariable String skillId,
            @PathVariable String correctionId,
            @RequestBody Map<String, Object> body
    ) {
        user.requireScope("skills:run");
        return Map.of("skill", skills.applyCorrection(
                user.ownerId(), skillId, correctionId, body));
    }

    @PostMapping("/{skillId}/corrections/{correctionId}/dismiss")
    Map<String, Object> dismiss(
            @PathVariable String skillId,
            @PathVariable String correctionId
    ) {
        user.requireScope("skills:run");
        return Map.of("skill", skills.dismissCorrection(
                user.ownerId(), skillId, correctionId));
    }

    @PostMapping("/{skillId}/corrections/{correctionId}/rollback")
    Map<String, Object> rollback(
            @PathVariable String skillId,
            @PathVariable String correctionId
    ) {
        user.requireScope("skills:run");
        return Map.of("skill", skills.rollback(user.ownerId(), skillId, correctionId));
    }

    @PostMapping("/risk/classify")
    Map<String, Object> classify(@RequestBody Map<String, Object> body) {
        user.requireScope("skills:read");
        var elements = SkillElements.from(body.get("elements"));
        var decision = SkillRiskPolicy.classify(
                object(body.get("action")), object(body.get("element")), elements);
        return Map.of(
                "tier", decision.tier().name().toLowerCase(),
                "needsConfirm", decision.needsConfirm(),
                "reason", decision.reason(),
                "matchedRedLine", decision.matchedRedLine() == null ? "" : decision.matchedRedLine(),
                "canRun", SkillRiskPolicy.canRun(decision, bool(body.get("autoConfirm"), false))
        );
    }

    private String value(Map<String, Object> input, String key) {
        return com.threadbeacon.control.common.Values.text(input.get(key));
    }
}
