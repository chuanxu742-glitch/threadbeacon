package com.threadbeacon.control.system;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.job.JobService;
import com.threadbeacon.control.node.NodeService;
import com.threadbeacon.control.schedule.ScheduleService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static com.threadbeacon.control.common.Values.*;

@RestController
@RequestMapping("/api")
public class SystemController {
    private final JdbcTemplate jdbc;private final CurrentUser user;private final NodeService nodes;private final JobService jobs;private final ScheduleService schedules;private final ObjectMapper mapper;
    public SystemController(JdbcTemplate jdbc,CurrentUser user,NodeService nodes,JobService jobs,ScheduleService schedules,ObjectMapper mapper){this.jdbc=jdbc;this.user=user;this.nodes=nodes;this.jobs=jobs;this.schedules=schedules;this.mapper=mapper;}

    @GetMapping("/health") Map<String,Object> health(){jdbc.queryForObject("SELECT 1",Integer.class);return Map.of("ok",true,"service","threadbeacon-control-api","runtime","spring-boot","database","postgresql","objectStorage","s3");}
    @GetMapping("/openapi") Map<String,Object> openapi(){var paths=new LinkedHashMap<String,Object>();paths.put("/api/health",Map.of("get",Map.of("summary","Health check")));paths.put("/api/jobs",Map.of("get",Map.of("summary","List jobs"),"post",Map.of("summary","Create job")));paths.put("/api/skills",Map.of("get",Map.of("summary","List governed Skills"),"post",Map.of("summary","Create a versioned Skill")));paths.put("/api/skills/{id}/runs",Map.of("post",Map.of("summary","Queue an auditable Skill run")));paths.put("/api/skills/{id}/runs/{runId}/reviews/{reviewId}/approve",Map.of("post",Map.of("summary","Approve one exact risky Agent action")));paths.put("/api/worker/skills/claim",Map.of("post",Map.of("summary","Claim a leased Agent Skill run")));paths.put("/api/integrations/dify/import",Map.of("post",Map.of("summary","Safely import a Dify YAML draft")));paths.put("/api/mcp",Map.of("post",Map.of("summary","MCP JSON-RPC endpoint for PAT clients")));paths.put("/api/v1/internal/geo-acquisition/executions",Map.of("post",Map.of("summary","Submit idempotent GEO acquisition")));return Map.of("openapi","3.1.0","info",Map.of("title","ThreadBeacon Control API","version","1.2.0"),"paths",paths);}

    @GetMapping("/dashboard") Map<String,Object> dashboard(){
        var owner=user.ownerId();var today=LocalDate.now(ZoneOffset.UTC).atStartOfDay().toInstant(ZoneOffset.UTC).toString();var cutoff=Instant.now().minus(60,ChronoUnit.SECONDS).toString();
        var metrics=new LinkedHashMap<String,Object>();metrics.put("runningJobs",count("SELECT count(*) FROM jobs WHERE owner_id=? AND status='running'",owner));metrics.put("queuedJobs",count("SELECT count(*) FROM jobs WHERE owner_id=? AND status='queued'",owner));metrics.put("completedToday",count("SELECT count(*) FROM jobs WHERE owner_id=? AND status='completed' AND finished_at>=?",owner,today));metrics.put("itemsToday",count("SELECT count(*) FROM records WHERE owner_id=? AND first_seen_at>=?",owner,today));metrics.put("onlineNodes",count("SELECT count(*) FROM nodes WHERE status='online' AND last_seen_at>=?",cutoff));metrics.put("totalNodes",count("SELECT count(*) FROM nodes"));metrics.put("availableSlots",count("SELECT COALESCE(sum(GREATEST(max_concurrency-active_jobs,0)),0) FROM nodes WHERE status='online' AND last_seen_at>=?",cutoff));var completed=count("SELECT count(*) FROM jobs WHERE owner_id=? AND status='completed'",owner);var failed=count("SELECT count(*) FROM jobs WHERE owner_id=? AND status='failed'",owner);metrics.put("successRate",completed+failed==0?0:completed*100/(completed+failed));metrics.put("recordsTotal",count("SELECT count(*) FROM records WHERE owner_id=?",owner));metrics.put("activeSchedules",count("SELECT count(*) FROM schedules WHERE owner_id=? AND enabled=1",owner));metrics.put("activeSkills",count("SELECT count(*) FROM skills WHERE owner_id=? AND status='active' AND enabled=1",owner));metrics.put("pendingSkillCorrections",count("SELECT count(*) FROM skill_corrections c JOIN skills s ON s.id=c.skill_id WHERE s.owner_id=? AND c.status='proposed'",owner));
        return Map.of("metrics",metrics,"jobs",jobs.list(owner,50),"nodes",nodes.list(),"reports",jdbc.queryForList("SELECT r.*,j.platform,j.keyword FROM reports r JOIN jobs j ON j.id=r.job_id WHERE r.owner_id=? ORDER BY r.created_at DESC LIMIT 20",owner),"schedules",schedules.list(owner),"records",jobs.records(owner,"","",20,0));
    }

    @GetMapping({"/platforms","/v1/capabilities"}) Map<String,Object> platforms(){
        var cutoff=Instant.now().minus(60,ChronoUnit.SECONDS).toString();var catalog=new TreeMap<String,int[]>();for(var row:jdbc.queryForList("SELECT capabilities_json,max_concurrency,active_jobs FROM nodes WHERE status='online' AND last_seen_at>=?",cutoff)){try{var capabilities=mapper.readValue(text(row.get("capabilities_json")),new TypeReference<List<String>>(){});for(var capability:capabilities){var stat=catalog.computeIfAbsent(capability,key->new int[2]);stat[0]++;stat[1]+=Math.max(0,integer(row.get("max_concurrency"),1)-integer(row.get("active_jobs"),0));}}catch(Exception ignored){}}
        var result=new ArrayList<Map<String,Object>>();catalog.forEach((key,value)->result.add(Map.of("id",key,"onlineNodes",value[0],"availableSlots",value[1],"status","online")));return Map.of("platforms",result);
    }

    @GetMapping("/schedules") Map<String,Object> schedules(){return Map.of("schedules",schedules.list(user.ownerId()));}
    @PostMapping("/schedules") Map<String,Object> createSchedule(@RequestBody Map<String,Object> body){return Map.of("schedule",schedules.create(user.ownerId(),body));}
    @PatchMapping("/schedules/{id}") Map<String,Object> scheduleAction(@PathVariable String id,@RequestBody Map<String,Object> body){schedules.action(user.ownerId(),id,text(body.get("action")));return Map.of("ok",true);}
    private int count(String sql,Object...args){Number value=jdbc.queryForObject(sql,Number.class,args);return value==null?0:value.intValue();}
}
