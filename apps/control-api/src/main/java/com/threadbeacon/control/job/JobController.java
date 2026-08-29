package com.threadbeacon.control.job;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.node.NodeService;
import com.threadbeacon.control.storage.ObjectStore;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.util.Map;

import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.text;

@RestController
@RequestMapping("/api")
public class JobController {
    private final JobService jobs;
    private final NodeService nodes;
    private final CurrentUser user;
    private final ObjectStore objects;

    public JobController(JobService jobs, NodeService nodes, CurrentUser user, ObjectStore objects) {
        this.jobs = jobs; this.nodes = nodes; this.user = user; this.objects = objects;
    }

    @GetMapping("/jobs") Map<String,Object> list(@RequestParam(defaultValue="50") int limit){return Map.of("jobs",jobs.list(user.ownerId(),limit));}
    @PostMapping("/jobs") ResponseEntity<Map<String,Object>> create(@RequestBody Map<String,Object> body){return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("job",jobs.create(user.ownerId(),body)));}
    @GetMapping("/jobs/{id}") Map<String,Object> get(@PathVariable String id){return Map.of("job",jobs.get(user.ownerId(),id));}
    @PatchMapping("/jobs/{id}") Map<String,Object> update(@PathVariable String id,@RequestBody Map<String,Object> body){return Map.of("job",jobs.transition(user.ownerId(),id,text(body.get("action"))));}
    @GetMapping("/jobs/{id}/events") Map<String,Object> events(@PathVariable String id,@RequestParam(defaultValue="200") int limit){return Map.of("events",jobs.events(user.ownerId(),id,limit));}

    @PostMapping("/worker/claim") Map<String,Object> claim(HttpServletRequest request,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);var result=new java.util.LinkedHashMap<String,Object>();result.put("job",jobs.claim(node));return result;}
    @PostMapping("/worker/jobs/{id}/complete") Map<String,Object> complete(HttpServletRequest request,@PathVariable String id,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);return Map.of("report",jobs.complete(node,id,object(body.get("report"))));}
    @PostMapping("/worker/jobs/{id}/fail") Map<String,Object> fail(HttpServletRequest request,@PathVariable String id,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);var message=text(body.get("error"));if(message.isBlank())message="Worker 未提供错误信息";return Map.of("job",jobs.fail(node,id,message));}

    @GetMapping({"/records","/v1/records"}) Map<String,Object> records(@RequestParam(defaultValue="") String search,@RequestParam(defaultValue="") String platform,@RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset){return Map.of("records",jobs.records(user.ownerId(),search.trim(),platform.trim(),limit,offset));}
    @GetMapping("/reports/{id}") void report(@PathVariable String id,HttpServletResponse response) throws Exception {var meta=jobs.reportMeta(user.ownerId(),id);response.setContentType("application/json");response.setHeader("Cache-Control","private, no-store");try(InputStream input=objects.get(text(meta.get("object_key")))){input.transferTo(response.getOutputStream());}}

    @SuppressWarnings("unchecked") private Map<String,Object> object(Object value){return value instanceof Map<?,?> map?(Map<String,Object>)map:Map.of();}
}
