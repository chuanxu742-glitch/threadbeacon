package com.threadbeacon.control.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.common.SecretBox;
import com.threadbeacon.control.job.JobService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import static com.threadbeacon.control.common.Values.*;

@RestController
@RequestMapping("/api/v1/owned-acquisitions")
public class CreatorOwnedController {
    private static final Set<String> PLATFORMS = Set.of("youtube", "tiktok", "instagram", "douyin", "xiaohongshu", "weibo", "kuaishou");
    private final CurrentUser user; private final JobService jobs; private final SecretBox secrets; private final JdbcTemplate jdbc; private final ObjectMapper mapper;

    public CreatorOwnedController(CurrentUser user, JobService jobs, SecretBox secrets, JdbcTemplate jdbc, ObjectMapper mapper) {
        this.user=user; this.jobs=jobs; this.secrets=secrets; this.jdbc=jdbc; this.mapper=mapper;
    }

    @PostMapping
    Map<String,Object> create(@RequestBody Map<String,Object> body) {
        user.requireRole("editor"); user.requireScope("owned:fetch");
        var platform=text(body.get("platform")); var grant=text(body.get("grantHandle")); var limit=integer(body.get("limit"),100);
        if(!PLATFORMS.contains(platform))throw new ApiException(HttpStatus.BAD_REQUEST,"fetchOwned 不支持的平台："+platform);
        if(grant.length()<16||grant.length()>2048)throw new ApiException(HttpStatus.BAD_REQUEST,"grantHandle 长度必须是 16-2048");
        if(limit<1||limit>1000)throw new ApiException(HttpStatus.BAD_REQUEST,"limit 必须是 1-1000");
        var fingerprint=hash(grant); var job=jobs.insert(user.ownerId(),Map.of("platform",platform,"keyword","creator-owned","limit",limit,"includeComments",bool(body.get("includeComments"),true)),Map.of("mode","fetchOwned","grantHandleEncrypted",secrets.encrypt(grant),"grantFingerprint",fingerprint));
        jdbc.update("INSERT INTO audit_logs(id,owner_id,action,resource_type,resource_id,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",id(),user.ownerId(),"owned.fetch.queued","job",text(job.get("id")),json(mapper,Map.of("platform",platform,"grantFingerprint",fingerprint)),now());
        return Map.of("job",sanitize(job));
    }

    @GetMapping("/{jobId}")
    Map<String,Object> get(@PathVariable String jobId) {
        user.requireScope("owned:fetch"); var job=jobs.get(user.ownerId(),jobId);
        var options=object(parse(mapper,job.get("source_options_json"),Map.of()));
        if(!"fetchOwned".equals(text(options.get("mode"))))throw new ApiException(HttpStatus.NOT_FOUND,"自有账号任务不存在");
        return Map.of("job",sanitize(job));
    }

    private Map<String,Object> sanitize(Map<String,Object> job) {
        var result=new LinkedHashMap<>(job); var options=new LinkedHashMap<>(object(parse(mapper,job.get("source_options_json"),Map.of())));
        options.remove("grantHandleEncrypted"); options.remove("grantHandle"); result.put("source_options_json",json(mapper,options)); return result;
    }
}
