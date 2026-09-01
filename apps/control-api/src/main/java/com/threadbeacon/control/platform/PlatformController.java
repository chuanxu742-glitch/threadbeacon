package com.threadbeacon.control.platform;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

import static com.threadbeacon.control.common.Values.text;

@RestController
@RequestMapping("/api")
public class PlatformController {
    private final PlatformService platform;private final CurrentUser user;
    public PlatformController(PlatformService platform,CurrentUser user){this.platform=platform;this.user=user;}
    @GetMapping("/studio") Map<String,Object> studio(){return platform.studio(user.ownerId());}
    @PostMapping("/studio") ResponseEntity<Map<String,Object>> studioAction(@RequestBody Map<String,Object> body){var action=text(body.get("action"));return switch(action){case "create-project"->ResponseEntity.status(HttpStatus.CREATED).body(Map.of("project",platform.createProject(user.ownerId(),body)));case "create-source"->ResponseEntity.status(HttpStatus.CREATED).body(Map.of("source",platform.createSource(user.ownerId(),body)));case "test-source"->ResponseEntity.status(HttpStatus.CREATED).body(Map.of("job",platform.testSource(user.ownerId(),text(body.get("sourceId")))));case "create-browser-profile"->ResponseEntity.status(HttpStatus.CREATED).body(Map.of("profile",platform.createProfile(user.ownerId(),body)));default->throw new ApiException(HttpStatus.BAD_REQUEST,"不支持的 Studio 操作");};}
    @GetMapping("/workflows") Map<String,Object> workflows(@RequestParam(required=false)String projectId){user.requireScope("runs:read");return Map.of("workflows",platform.listWorkflows(user.ownerId(),projectId));}
    @PostMapping("/workflows") ResponseEntity<Map<String,Object>> createWorkflow(@RequestBody Map<String,Object> body){user.requireScope("workflows:run");return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("workflow",platform.createWorkflow(user.ownerId(),body)));}
    @GetMapping("/workflows/{id}") Map<String,Object> workflow(@PathVariable String id){user.requireScope("runs:read");return Map.of("workflow",platform.workflow(user.ownerId(),id));}
    @PatchMapping("/workflows/{id}") ResponseEntity<Map<String,Object>> workflowAction(@PathVariable String id,@RequestBody Map<String,Object> body){user.requireScope("workflows:run");var action=text(body.get("action"));if("publish".equals(action))return ResponseEntity.ok(Map.of("version",platform.publish(user.ownerId(),id)));if("run".equals(action))return ResponseEntity.status(HttpStatus.CREATED).body(platform.run(user.ownerId(),id));return ResponseEntity.ok(Map.of("workflow",platform.saveWorkflow(user.ownerId(),id,body)));}
    @GetMapping("/workflows/runs/{id}") Map<String,Object> run(@PathVariable String id){user.requireScope("runs:read");return platform.runDetails(user.ownerId(),id);}
    @GetMapping("/governance") Map<String,Object> governance(){return platform.governance(user.ownerId());}
    @GetMapping("/product-metrics") Map<String,Object> productMetrics(@RequestParam(required=false) String projectId){return platform.productMetrics(user.ownerId(),projectId);}
    @PostMapping("/governance") ResponseEntity<Map<String,Object>> rule(@RequestBody Map<String,Object> body){return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("rule",platform.createRule(user.ownerId(),body)));}
    @PatchMapping("/governance/delivery/{id}") Map<String,Object> toggle(@PathVariable String id){platform.toggleRule(user.ownerId(),id);return Map.of("ok",true);}
}
