package com.threadbeacon.control.browser;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.SecretBox;
import com.threadbeacon.control.node.WorkerNode;
import com.threadbeacon.control.storage.ObjectStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.URI;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static com.threadbeacon.control.common.Values.*;

@Service
public class BrowserService {
    private static final Set<String> ACTIONS=Set.of("session.create","session.close","tabs.list","tabs.open","tabs.close","navigate","snapshot","click","type","screenshot");
    private final JdbcTemplate jdbc;private final TransactionTemplate transactions;private final ObjectMapper mapper;private final SecretBox secrets;private final ObjectStore objects;
    public BrowserService(JdbcTemplate jdbc,TransactionTemplate transactions,ObjectMapper mapper,SecretBox secrets,ObjectStore objects){this.jdbc=jdbc;this.transactions=transactions;this.mapper=mapper;this.secrets=secrets;this.objects=objects;}

    public Map<String,Object> list(String ownerId){return Map.of("sessions",jdbc.queryForList("SELECT * FROM browser_sessions WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",ownerId),"actions",jdbc.queryForList("SELECT id,session_id,owner_id,node_id,type,status,result_json,error,screenshot_key,timeout_ms,created_at,started_at,finished_at FROM browser_actions WHERE owner_id=? ORDER BY created_at DESC LIMIT 300",ownerId),"capability",Map.of("protocolVersion",1,"actions",ACTIONS,"transport","worker-cdp","arbitraryJavaScript",false));}

    public Map<String,Object> createSession(String ownerId,Map<String,Object> body){
        var profileId=text(body.get("profileId"));var profiles=jdbc.queryForList("SELECT * FROM browser_profiles WHERE id=? AND owner_id=?",profileId,ownerId);if(profiles.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"浏览器 Profile 不存在");var profile=profiles.get(0);var requested=text(body.get("nodeId"));if(requested.isBlank())requested=text(profile.get("node_id"));var cutoff=Instant.now().minus(60,ChronoUnit.SECONDS).toString();String nodeId=null;
        for(var node:jdbc.queryForList("SELECT id,runtime_json FROM nodes WHERE status='online' AND last_seen_at>=? ORDER BY active_jobs,last_seen_at DESC",cutoff)){if(!requested.isBlank()&&!requested.equals(text(node.get("id"))))continue;if(attestationMatches(text(node.get("runtime_json")),text(profile.get("profile_name")),text(profile.get("profile_kind")))){nodeId=text(node.get("id"));break;}}
        if(nodeId==null)throw new ApiException(HttpStatus.CONFLICT,"没有匹配 Profile 且通过新鲜证明的在线浏览器 Worker");var allowlist=strings(body.get("allowlist"));if(allowlist.isEmpty())allowlist=parseStrings(text(profile.get("site_bindings_json")));if(allowlist.isEmpty()||allowlist.stream().anyMatch(value->!validHost(value)))throw new ApiException(HttpStatus.BAD_REQUEST,"浏览器会话必须配置有效的域名 allowlist");var timeout=Math.max(3000,Math.min(60000,integer(body.get("timeoutMs"),30000)));var ttl=Math.max(1,Math.min(24,integer(body.get("ttlHours"),2)));var sessionId=id();var timestamp=now();var expires=Instant.now().plus(ttl,ChronoUnit.HOURS).toString();var finalNodeId=nodeId;var finalAllowlist=allowlist;
        transactions.executeWithoutResult(status->{jdbc.update("INSERT INTO browser_sessions(id,owner_id,profile_id,node_id,status,target_id,tab_ids_json,allowlist_json,timeout_ms,capability,created_at,updated_at,expires_at) VALUES(?,?,?,?,'starting',NULL,'[]',?,?,'cdp',?,?,?)",sessionId,ownerId,profileId,finalNodeId,json(mapper,finalAllowlist),timeout,timestamp,timestamp,expires);insertAction(ownerId,sessionId,finalNodeId,timeout,"session.create",Map.of());});return jdbc.queryForMap("SELECT * FROM browser_sessions WHERE id=?",sessionId);
    }

    public void close(String ownerId,String sessionId){var sessions=jdbc.queryForList("SELECT * FROM browser_sessions WHERE id=? AND owner_id=? AND status NOT IN ('closed','closing')",sessionId,ownerId);if(sessions.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"浏览器会话不存在");var session=sessions.get(0);transactions.executeWithoutResult(status->{jdbc.update("UPDATE browser_sessions SET status='closing',updated_at=? WHERE id=?",now(),sessionId);insertAction(ownerId,sessionId,text(session.get("node_id")),integer(session.get("timeout_ms"),30000),"session.close",Map.of());});}

    public void queue(String ownerId,String sessionId,Map<String,Object> body){var type=text(body.get("type"));if(!ACTIONS.contains(type)||type.startsWith("session."))throw new ApiException(HttpStatus.BAD_REQUEST,"浏览器动作类型无效");var sessions=jdbc.queryForList("SELECT * FROM browser_sessions WHERE id=? AND owner_id=? AND status IN ('active','starting') AND expires_at>?",sessionId,ownerId,now());if(sessions.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"浏览器会话不存在、已关闭或已过期");var session=sessions.get(0);var input=object(body.get("input"));var target=text(input.get("targetId"));if(!target.isBlank()&&!parseStrings(text(session.get("tab_ids_json"))).contains(target))throw new ApiException(HttpStatus.BAD_REQUEST,"目标标签页不属于当前会话");var targetUrl=text(input.get("url"));if(!targetUrl.isBlank()&&!urlAllowed(targetUrl,parseStrings(text(session.get("allowlist_json")))))throw new ApiException(HttpStatus.BAD_REQUEST,"URL 不在 HTTPS allowlist 内");insertAction(ownerId,sessionId,text(session.get("node_id")),integer(session.get("timeout_ms"),30000),type,input);}

    public Map<String,Object> claim(WorkerNode node){return transactions.execute(status->{var rows=jdbc.queryForList("""
        SELECT a.*,s.target_id,s.tab_ids_json,s.allowlist_json FROM browser_actions a JOIN browser_sessions s ON s.id=a.session_id
        WHERE a.node_id=? AND a.status='queued' AND s.expires_at>? ORDER BY a.created_at FOR UPDATE SKIP LOCKED LIMIT 1
        """,node.id(),now());if(rows.isEmpty())return null;var action=rows.get(0);jdbc.update("UPDATE browser_actions SET status='running',started_at=? WHERE id=? AND status='queued'",now(),action.get("id"));return Map.of("id",action.get("id"),"sessionId",action.get("session_id"),"type",action.get("type"),"timeoutMs",action.get("timeout_ms"),"targetId",Optional.ofNullable(action.get("target_id")).orElse(""),"allowedTargetIds",parse(mapper,action.get("tab_ids_json"),List.of()),"allowlist",parse(mapper,action.get("allowlist_json"),List.of()),"input",parse(mapper,secrets.decrypt(text(action.get("payload_encrypted"))),Map.of()));});}

    public void complete(WorkerNode node,String actionId,Map<String,Object> result){
        var rows=jdbc.queryForList("SELECT * FROM browser_actions WHERE id=? AND node_id=? AND status='running'",actionId,node.id());if(rows.isEmpty())throw new ApiException(HttpStatus.CONFLICT,"浏览器动作租约失效");var action=rows.get(0);var safe=new LinkedHashMap<>(result);var screenshot= text(safe.remove("screenshotBase64"));String screenshotKey=null;if(!screenshot.isBlank()){try{var bytes=Base64.getDecoder().decode(screenshot);if(bytes.length>10*1024*1024)throw new IllegalArgumentException();var mime="image/jpeg".equals(result.get("screenshotMime"))?"image/jpeg":"image/png";screenshotKey="browser/"+action.get("owner_id")+"/"+action.get("session_id")+"/"+actionId+(mime.equals("image/jpeg")?".jpg":".png");objects.put(screenshotKey,bytes,mime);}catch(Exception error){throw new ApiException(HttpStatus.BAD_REQUEST,"浏览器截图无效或超过 10 MiB");}}
        var timestamp=now();var type=text(action.get("type"));var sessionId=text(action.get("session_id"));var session=jdbc.queryForMap("SELECT target_id,tab_ids_json FROM browser_sessions WHERE id=?",sessionId);var tabs=new LinkedHashSet<>(parseStrings(text(session.get("tab_ids_json"))));var target=text(result.get("targetId"));
        if((type.equals("session.create")||type.equals("tabs.open"))&&!target.isBlank())tabs.add(target);
        if(type.equals("tabs.list")){var listed=resultTabs(result);if(!listed.isEmpty())tabs=new LinkedHashSet<>(listed);}
        var detail=object(result.get("detail"));var closedTarget=text(detail.get("closedTargetId"));if(type.equals("tabs.close")&&!closedTarget.isBlank())tabs.remove(closedTarget);
        if(type.equals("session.close"))tabs.clear();
        String nextTarget;if(type.equals("session.close"))nextTarget=null;else if(!target.isBlank())nextTarget=target;else if(closedTarget.equals(text(session.get("target_id"))))nextTarget=tabs.stream().findFirst().orElse(null);else nextTarget=text(session.get("target_id"));
        var status=type.equals("session.close")?"closed":"active";var finalScreenshotKey=screenshotKey;var finalTabs=json(mapper,tabs);var finalTarget=nextTarget;transactions.executeWithoutResult(tx->{jdbc.update("UPDATE browser_actions SET status='completed',result_json=?,screenshot_key=?,finished_at=? WHERE id=? AND node_id=? AND status='running'",json(mapper,safe),finalScreenshotKey,timestamp,actionId,node.id());jdbc.update("UPDATE browser_sessions SET status=?,target_id=?,tab_ids_json=?,last_error=NULL,updated_at=?,closed_at=CASE WHEN ?='closed' THEN ? ELSE closed_at END WHERE id=?",status,finalTarget,finalTabs,timestamp,status,timestamp,sessionId);});
    }
    public Screenshot screenshot(String ownerId,String actionId){var rows=jdbc.queryForList("SELECT screenshot_key FROM browser_actions WHERE id=? AND owner_id=? AND status='completed'",actionId,ownerId);if(rows.isEmpty()||text(rows.get(0).get("screenshot_key")).isBlank())throw new ApiException(HttpStatus.NOT_FOUND,"浏览器截图不存在");var key=text(rows.get(0).get("screenshot_key"));try{return new Screenshot(objects.get(key),key.endsWith(".jpg")?"image/jpeg":"image/png");}catch(Exception error){throw new ApiException(HttpStatus.NOT_FOUND,"浏览器截图不存在");}}
    public void fail(WorkerNode node,String actionId,String message){var timestamp=now();var sessions=jdbc.queryForList("SELECT session_id FROM browser_actions WHERE id=? AND node_id=? AND status='running'",actionId,node.id());if(sessions.isEmpty())throw new ApiException(HttpStatus.CONFLICT,"浏览器动作租约失效");jdbc.update("UPDATE browser_actions SET status='failed',error=?,finished_at=? WHERE id=?",message.substring(0,Math.min(2000,message.length())),timestamp,actionId);jdbc.update("UPDATE browser_sessions SET last_error=?,updated_at=?,status=CASE WHEN status IN ('starting','closing') THEN 'failed' ELSE status END WHERE id=?",message,timestamp,sessions.get(0).get("session_id"));}

    private void insertAction(String ownerId,String sessionId,String nodeId,int timeout,String type,Map<String,Object> input){jdbc.update("INSERT INTO browser_actions(id,session_id,owner_id,node_id,type,status,payload_encrypted,timeout_ms,created_at) VALUES(?,?,?,?,?,'queued',?,?,?)",id(),sessionId,ownerId,nodeId,type,secrets.encrypt(json(mapper,input)),timeout,now());}
    private boolean attestationMatches(String runtimeJson,String name,String kind){try{var runtime=mapper.readValue(runtimeJson,new TypeReference<Map<String,Object>>(){});var att=object(runtime.get("browserAttestation"));return Boolean.TRUE.equals(runtime.get("browserEndpointConfigured"))&&Boolean.TRUE.equals(att.get("verified"))&&name.equals(text(att.get("profileName")))&&kind.equals(text(att.get("profileKind")))&&Instant.parse(text(att.get("expiresAt"))).isAfter(Instant.now());}catch(Exception ignored){return false;}}
    private List<String> parseStrings(String value){try{return mapper.readValue(value,new TypeReference<List<String>>(){});}catch(Exception ignored){return List.of();}}
    private List<String> resultTabs(Map<String,Object> result){var ids=new ArrayList<String>();for(var tab:array(result.get("tabs"))){var id=text(object(tab).get("id"));if(id.isBlank())id=text(object(tab).get("targetId"));if(!id.isBlank())ids.add(id);}return ids;}
    private boolean validHost(String value){return value.matches("(?i)^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$")&&!value.equalsIgnoreCase("localhost")&&!value.endsWith(".local");}
    private boolean urlAllowed(String value,List<String> allowlist){try{var uri=URI.create(value);if(!"https".equals(uri.getScheme())||uri.getHost()==null)return false;var host=uri.getHost().toLowerCase(Locale.ROOT);return allowlist.stream().map(item->item.toLowerCase(Locale.ROOT)).anyMatch(item->host.equals(item)||host.endsWith("."+item));}catch(Exception ignored){return false;}}
    public record Screenshot(java.io.InputStream stream,String contentType){}
}
