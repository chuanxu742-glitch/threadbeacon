package com.threadbeacon.control.skill;

import com.threadbeacon.control.node.NodeService;
import com.threadbeacon.control.platform.WorkflowRuntimeService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

import static com.threadbeacon.control.common.Values.text;

@RestController
@RequestMapping("/api/worker/skills")
public class WorkerSkillController {
    private final SkillService skills;
    private final NodeService nodes;
    private final WorkflowRuntimeService workflowRuntime;

    public WorkerSkillController(SkillService skills, NodeService nodes, WorkflowRuntimeService workflowRuntime) {
        this.skills = skills;
        this.nodes = nodes;
        this.workflowRuntime = workflowRuntime;
    }

    @PostMapping("/claim")
    Map<String, Object> claim(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        var response = new LinkedHashMap<String, Object>();
        response.put("run", skills.claim(nodes.authenticate(request, body)));
        return response;
    }

    @PostMapping("/{runId}/pause")
    Map<String, Object> pause(HttpServletRequest request, @PathVariable String runId,
                              @RequestBody Map<String, Object> body) {
        var run = skills.pauseForConfirmation(nodes.authenticate(request, body), runId, body);
        workflowRuntime.skillPaused(text(run.get("workflow_run_id")));
        return Map.of("run", run);
    }

    @PostMapping("/{runId}/complete")
    Map<String, Object> complete(HttpServletRequest request, @PathVariable String runId,
                                 @RequestBody Map<String, Object> body) {
        var run = skills.completeFromWorker(nodes.authenticate(request, body), runId, body);
        workflowRuntime.skillFinished(text(run.get("workflow_run_id")), text(run.get("workflow_node_id")), text(run.get("status")), run);
        return Map.of("run", run);
    }

    @PostMapping("/{runId}/fail")
    Map<String, Object> fail(HttpServletRequest request, @PathVariable String runId,
                             @RequestBody Map<String, Object> body) {
        var error = text(body.get("error"));
        if (error.isBlank()) error = "Agent Worker 未提供错误";
        var run = skills.failFromWorker(nodes.authenticate(request, body), runId, error);
        if ("failed".equals(text(run.get("status")))) workflowRuntime.skillFinished(
                text(run.get("workflow_run_id")), text(run.get("workflow_node_id")), text(run.get("status")), run);
        return Map.of("run", run);
    }
}
