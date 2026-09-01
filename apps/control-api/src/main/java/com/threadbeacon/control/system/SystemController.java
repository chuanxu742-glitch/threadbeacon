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
    @GetMapping("/openapi") Map<String,Object> openapi(){
        var paths=new LinkedHashMap<String,Object>();
        paths.put("/api/health",Map.of("get",operation("Health check")));
        paths.put("/api/v2/me/context",Map.of("get",operation("Read workspace context and system pulse")));
        paths.put("/api/v2/attention",Map.of("get",operation("List attention projections")));
        paths.put("/api/v2/attention/{id}",Map.of("get",operation("Read an attention item"),"patch",operation("Resolve or ignore an attention item")));
        paths.put("/api/v2/projects",Map.of("get",operation("List projects"),"post",operation("Create a project")));
        paths.put("/api/v2/projects/{id}",Map.of("get",operation("Read a project"),"patch",operation("Update or archive a project with revision control")));
        paths.put("/api/v2/projects/{id}/readiness",Map.of("get",operation("Derive project readiness")));
        paths.put("/api/v2/projects/{id}/sources",Map.of("get",operation("List project sources"),"post",operation("Create a project source")));
        paths.put("/api/v2/projects/{id}/workflows",Map.of("get",operation("List project workflows"),"post",operation("Create a workflow draft")));
        paths.put("/api/v2/workflows/{id}/draft",Map.of("get",operation("Read a workflow draft"),"put",operation("Save a revision-controlled workflow draft")));
        paths.put("/api/v2/workflows/{id}/validate",Map.of("post",operation("Validate a workflow draft")));
        paths.put("/api/v2/workflows/{id}/publish",Map.of("post",operation("Publish an immutable workflow version")));
        paths.put("/api/v2/workflow-versions/{id}/runs",Map.of("post",operation("Create an idempotent project run")));
        paths.put("/api/v2/projects/{id}/runs",Map.of("get",operation("List project runs")));
        paths.put("/api/v2/runs/{id}",Map.of("get",operation("Read a run projection")));
        paths.put("/api/v2/projects/{id}/observations",Map.of("get",operation("List immutable observations")));
        paths.put("/api/v2/projects/{id}/findings",Map.of("get",operation("List versioned findings")));
        paths.put("/api/v2/findings/{id}/reviews",Map.of("post",operation("Append a finding review revision")));
        paths.put("/api/v2/projects/{id}/reports",Map.of("get",operation("List immutable report versions")));
        paths.put("/api/v2/report-drafts/{id}/publish",Map.of("post",operation("Publish an immutable report version")));
        paths.put("/api/v2/reports/{id}/deliveries",Map.of("post",operation("Create an idempotent delivery operation")));
        paths.put("/api/v2/deliveries/{id}",Map.of("get",operation("Read delivery attempts and business outcome")));
        paths.put("/api/v2/automations",Map.of("get",operation("List repeatable workflow, schedule, and Skill methods")));
        paths.put("/api/v2/capabilities/readiness",Map.of("get",operation("Read workspace capability readiness")));
        paths.put("/api/v2/workspace/members",Map.of("get",operation("List workspace members")));
        paths.put("/api/v2/settings/developer",Map.of("get",operation("Read safe developer access metadata")));
        paths.put("/api/v2/settings/audit",Map.of("get",operation("Read cursor-paginated audit events")));
        paths.put("/api/worker/skills/claim",Map.of("post",operation("Claim a leased Agent Skill run")));
        paths.put("/api/mcp",Map.of("post",operation("MCP JSON-RPC endpoint for PAT clients")));
        return Map.of("openapi","3.1.0","info",Map.of("title","ThreadBeacon Control API","version","2.0.0"),"paths",paths);
    }

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
    private Map<String,Object> operation(String summary){return Map.of("summary",summary);}
    private int count(String sql,Object...args){Number value=jdbc.queryForObject(sql,Number.class,args);return value==null?0:value.intValue();}
}
