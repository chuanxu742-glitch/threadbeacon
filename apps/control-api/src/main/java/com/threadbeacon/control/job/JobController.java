package com.threadbeacon.control.job;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.node.NodeService;
import com.threadbeacon.control.storage.ObjectStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
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
    private final ObjectMapper mapper;

    public JobController(JobService jobs, NodeService nodes, CurrentUser user, ObjectStore objects, ObjectMapper mapper) {
        this.jobs = jobs; this.nodes = nodes; this.user = user; this.objects = objects; this.mapper = mapper;
    }

    @GetMapping("/jobs") Map<String,Object> list(@RequestParam(defaultValue="50") int limit){return Map.of("jobs",jobs.list(user.ownerId(),limit));}
    @PostMapping("/jobs") ResponseEntity<Map<String,Object>> create(@RequestBody Map<String,Object> body){return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("job",jobs.create(user.ownerId(),body)));}
    @GetMapping("/jobs/{id}") Map<String,Object> get(@PathVariable String id){return Map.of("job",jobs.get(user.ownerId(),id));}
    @PatchMapping("/jobs/{id}") Map<String,Object> update(@PathVariable String id,@RequestBody Map<String,Object> body){return Map.of("job",jobs.transition(user.ownerId(),id,text(body.get("action"))));}
    @GetMapping("/jobs/{id}/events") Map<String,Object> events(@PathVariable String id,@RequestParam(defaultValue="200") int limit){return Map.of("events",jobs.events(user.ownerId(),id,limit));}

    @PostMapping("/worker/claim") Map<String,Object> claim(HttpServletRequest request,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);var result=new java.util.LinkedHashMap<String,Object>();result.put("job",jobs.claim(node));return result;}
    @PostMapping("/worker/jobs/{id}/complete") Map<String,Object> complete(HttpServletRequest request,@PathVariable String id,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);return Map.of("report",jobs.complete(node,id,object(body.get("report"))));}
    @PostMapping("/worker/jobs/{id}/fail") Map<String,Object> fail(HttpServletRequest request,@PathVariable String id,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);var message=text(body.get("error"));if(message.isBlank())message="Worker 未提供错误信息";return Map.of("job",jobs.fail(node,id,message));}

    @GetMapping({"/records","/v1/records"}) Map<String,Object> records(@RequestParam(defaultValue="") String search,@RequestParam(defaultValue="") String platform,@RequestParam(defaultValue="50") int limit,@RequestParam(defaultValue="0") int offset){user.requireScope("records:read");var query=search.trim();var source=platform.trim();var result=new LinkedHashMap<String,Object>();result.put("records",jobs.records(user.ownerId(),query,source,limit,offset));result.put("total",jobs.recordCount(user.ownerId(),query,source));return result;}
    @GetMapping("/exports") void export(@RequestParam(defaultValue="json") String format,@RequestParam(defaultValue="") String search,@RequestParam(defaultValue="") String platform,HttpServletResponse response) throws Exception {user.requireScope("records:read");var records=jobs.exportRecords(user.ownerId(),search.trim(),platform.trim());response.setHeader("Cache-Control","private, no-store");if("csv".equalsIgnoreCase(format)){response.setContentType("text/csv;charset=UTF-8");response.setHeader("Content-Disposition","attachment; filename=threadbeacon-records.csv");var columns=List.of("id","platform","source_item_id","item_type","title","content","author","url","observed_at","duplicate_count");var csv=new StringBuilder(String.join(",",columns)).append('\n');for(var record:records){for(int index=0;index<columns.size();index++){if(index>0)csv.append(',');csv.append(csv(record.get(columns.get(index))));}csv.append('\n');}response.getOutputStream().write(csv.toString().getBytes(StandardCharsets.UTF_8));return;}response.setContentType("application/json");response.setHeader("Content-Disposition","attachment; filename=threadbeacon-records.json");mapper.writeValue(response.getOutputStream(),Map.of("records",records,"total",records.size()));}
    @GetMapping("/reports/{id}") void report(@PathVariable String id,HttpServletResponse response) throws Exception {user.requireScope("records:read");var meta=jobs.reportMeta(user.ownerId(),id);response.setContentType("application/json");response.setHeader("Cache-Control","private, no-store");try(InputStream input=objects.get(text(meta.get("object_key")))){input.transferTo(response.getOutputStream());}}

    private String csv(Object value){var text=value==null?"":String.valueOf(value);return "\""+text.replace("\"","\"\"")+"\"";}
    @SuppressWarnings("unchecked") private Map<String,Object> object(Object value){return value instanceof Map<?,?> map?(Map<String,Object>)map:Map.of();}
}
