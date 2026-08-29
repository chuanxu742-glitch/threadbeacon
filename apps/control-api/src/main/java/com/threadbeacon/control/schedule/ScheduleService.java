package com.threadbeacon.control.schedule;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.job.JobService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.*;

@Service
public class ScheduleService {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final JobService jobs;

    public ScheduleService(JdbcTemplate jdbc, TransactionTemplate transactions, JobService jobs) {
        this.jdbc = jdbc; this.transactions = transactions; this.jobs = jobs;
    }

    public List<Map<String,Object>> list(String ownerId){return jdbc.queryForList("SELECT *,CASE WHEN cron_expression IS NULL THEN 'interval' ELSE 'cron' END AS schedule_type FROM schedules WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",ownerId);}

    public Map<String,Object> create(String ownerId,Map<String,Object> body){
        var name=text(body.get("name"));var platform=text(body.get("platform"));var keyword=text(body.get("keyword"));var interval=integer(body.get("intervalMinutes"),60);var cron=text(body.get("cronExpression"));var timezone=text(body.get("timezone"));if(timezone.isBlank())timezone="UTC";
        if(name.isBlank()||name.length()>80||keyword.isBlank()||interval<1||interval>525600)throw new ApiException(HttpStatus.BAD_REQUEST,"定时计划参数无效");
        if(!cron.isBlank()){try{parseCron(cron);ZoneId.of(timezone);}catch(Exception error){throw new ApiException(HttpStatus.BAD_REQUEST,"Cron 表达式或时区无效");}}
        var scheduleId=id();var timestamp=now();var next=bool(body.get("runImmediately"),true)?timestamp:nextRun(interval,cron,timezone,Instant.now());
        jdbc.update("""
            INSERT INTO schedules(id,owner_id,name,platform,keyword,source_options_json,"limit",include_comments,interval_minutes,cron_expression,timezone,priority,enabled,next_run_at,created_at,updated_at)
            VALUES(?,?,?,?,?,'{}',?,?,?,?,?,?,1,?,?,?)
            """,scheduleId,ownerId,name,platform,keyword,integer(body.get("limit"),100),bool(body.get("includeComments"),true)?1:0,interval,cron.isBlank()?null:cron,timezone,integer(body.get("priority"),0),next,timestamp,timestamp);
        return jdbc.queryForMap("SELECT * FROM schedules WHERE id=?",scheduleId);
    }

    public void action(String ownerId,String scheduleId,String action){
        var timestamp=now();
        switch(action){
            case "pause" -> requireChanged(jdbc.update("UPDATE schedules SET enabled=0,updated_at=? WHERE id=? AND owner_id=?",timestamp,scheduleId,ownerId));
            case "resume" -> requireChanged(jdbc.update("UPDATE schedules SET enabled=1,updated_at=? WHERE id=? AND owner_id=?",timestamp,scheduleId,ownerId));
            case "run" -> {var rows=jdbc.queryForList("SELECT * FROM schedules WHERE id=? AND owner_id=?",scheduleId,ownerId);if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"计划不存在");enqueue(rows.get(0),timestamp);}
            default -> throw new ApiException(HttpStatus.BAD_REQUEST,"action 必须是 pause、resume 或 run");
        }
    }

    @Scheduled(fixedDelayString="${threadbeacon.scheduling.scan-delay-ms:30000}")
    public void enqueueDue(){
        transactions.executeWithoutResult(status->{Boolean locked=jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(42819421)",Boolean.class);if(!Boolean.TRUE.equals(locked))return;var timestamp=now();for(var schedule:jdbc.queryForList("SELECT * FROM schedules WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 50",timestamp)){enqueue(schedule,timestamp);}});
    }

    private void enqueue(Map<String,Object> schedule,String occurrence){
        var body=new LinkedHashMap<String,Object>();body.put("platform",schedule.get("platform"));body.put("keyword",schedule.get("keyword"));body.put("limit",schedule.get("limit"));body.put("includeComments",integer(schedule.get("include_comments"),1)==1);body.put("priority",schedule.get("priority"));
        var job=jobs.insert(text(schedule.get("owner_id")),body,Map.of("scheduleId",schedule.get("id"),"scheduledFor",occurrence));
        jdbc.update("UPDATE jobs SET schedule_id=?,scheduled_for=? WHERE id=?",schedule.get("id"),occurrence,job.get("id"));
        var next=nextRun(integer(schedule.get("interval_minutes"),60),text(schedule.get("cron_expression")),text(schedule.get("timezone")),Instant.parse(occurrence));
        jdbc.update("UPDATE schedules SET last_run_at=?,next_run_at=?,updated_at=? WHERE id=?",occurrence,next,now(),schedule.get("id"));
    }

    private String nextRun(int interval,String cron,String timezone,Instant from){
        if(cron.isBlank())return from.plus(interval,ChronoUnit.MINUTES).toString();
        var next=parseCron(cron).next(ZonedDateTime.ofInstant(from,ZoneId.of(timezone)));if(next==null)throw new ApiException(HttpStatus.BAD_REQUEST,"Cron 无法计算下一次运行时间");return next.toInstant().toString();
    }
    static CronExpression parseCron(String value){var cron=value.trim();if(cron.split("\\s+").length==5)cron="0 "+cron;return CronExpression.parse(cron);}
    private void requireChanged(int changed){if(changed!=1)throw new ApiException(HttpStatus.NOT_FOUND,"计划不存在");}
}
