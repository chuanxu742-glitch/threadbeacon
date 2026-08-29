package com.threadbeacon.control.integration;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.platform.PlatformService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.threadbeacon.control.common.Values.*;

@RestController
@RequestMapping("/api")
public class IntegrationController {
    private final JdbcTemplate jdbc;private final CurrentUser user;private final PlatformService platform;private final ObjectMapper mapper;private final McpService mcpService;private final DifyImportService dify;
    public IntegrationController(JdbcTemplate jdbc,CurrentUser user,PlatformService platform,ObjectMapper mapper,McpService mcpService,DifyImportService dify){this.jdbc=jdbc;this.user=user;this.platform=platform;this.mapper=mapper;this.mcpService=mcpService;this.dify=dify;}

    @GetMapping("/integrations/tokens") Map<String,Object> tokens(){return Map.of("tokens",jdbc.queryForList("SELECT id,name,role,scopes_json,token_prefix,last_used_at,expires_at,revoked_at,created_at FROM api_tokens WHERE owner_id=? ORDER BY created_at DESC",user.ownerId()));}
    @PostMapping("/integrations/tokens") Map<String,Object> createToken(@RequestBody Map<String,Object> body){user.requireRole("owner");var name=text(body.get("name"));var role=text(body.get("role"));if(role.isBlank())role="viewer";if(!java.util.Set.of("viewer","editor").contains(role))throw new ApiException(HttpStatus.BAD_REQUEST,"Token role 只允许 viewer/editor");var requested=strings(body.get("scopes"));var allowed=java.util.Set.of("records:read","runs:read","workflows:run","skills:read","skills:run","owned:fetch");if(requested.isEmpty())requested=role.equals("editor")?List.of("records:read","runs:read","workflows:run","skills:read","skills:run","owned:fetch"):List.of("records:read","runs:read","skills:read");if(!allowed.containsAll(requested))throw new ApiException(HttpStatus.BAD_REQUEST,"Token scopes 无效");var days=Math.max(1,Math.min(365,integer(body.get("expiresInDays"),30)));if(name.isBlank()||name.length()>80)throw new ApiException(HttpStatus.BAD_REQUEST,"Token 名称无效");var token="threadbeacon_"+UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");var tokenId=id();var timestamp=now();jdbc.update("INSERT INTO api_tokens(id,owner_id,name,token_hash,token_prefix,expires_at,role,scopes_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",tokenId,user.ownerId(),name,hash(token),token.substring(0,12)+"…",Instant.now().plus(days,ChronoUnit.DAYS).toString(),role,json(mapper,requested),user.ownerId(),timestamp);return Map.of("id",tokenId,"token",token,"role",role,"scopes",requested);}
    @PatchMapping("/integrations/tokens") Map<String,Object> revokeToken(@RequestBody Map<String,Object> body){if(jdbc.update("UPDATE api_tokens SET revoked_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL",now(),text(body.get("id")),user.ownerId())!=1)throw new ApiException(HttpStatus.NOT_FOUND,"Token 不存在或已撤销");return Map.of("ok",true);}

    @GetMapping("/integrations/webhooks") Map<String,Object> webhooks(){return Map.of("triggers",jdbc.queryForList("SELECT id,workflow_id,name,enabled,last_triggered_at,created_at,updated_at FROM workflow_triggers WHERE owner_id=? ORDER BY created_at DESC",user.ownerId()));}
    @PostMapping("/integrations/webhooks") Map<String,Object> createWebhook(@RequestBody Map<String,Object> body){var workflowId=text(body.get("workflowId"));platform.workflow(user.ownerId(),workflowId);var name=text(body.get("name"));if(name.isBlank())throw new ApiException(HttpStatus.BAD_REQUEST,"Webhook 名称无效");var token=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");var triggerId=id();var timestamp=now();jdbc.update("INSERT INTO workflow_triggers(id,workflow_id,owner_id,name,token_hash,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",triggerId,workflowId,user.ownerId(),name,hash(token),timestamp,timestamp);return Map.of("trigger",jdbc.queryForMap("SELECT id,workflow_id,name,enabled,created_at FROM workflow_triggers WHERE id=?",triggerId),"token",token,"webhookUrl","/api/integrations/webhooks/"+token);}
    @PatchMapping("/integrations/webhooks") Map<String,Object> toggleWebhook(@RequestBody Map<String,Object> body){if(jdbc.update("UPDATE workflow_triggers SET enabled=?,updated_at=? WHERE id=? AND owner_id=?",bool(body.get("enabled"),true)?1:0,now(),text(body.get("id")),user.ownerId())!=1)throw new ApiException(HttpStatus.NOT_FOUND,"Webhook 不存在");return Map.of("ok",true);}
    @PostMapping("/integrations/webhooks/{token}") Map<String,Object> invoke(@PathVariable String token,@RequestBody(required=false) Map<String,Object> ignored){var rows=jdbc.queryForList("SELECT * FROM workflow_triggers WHERE token_hash=? AND enabled=1",hash(token));if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"Webhook 不存在");var trigger=rows.get(0);var result=platform.run(text(trigger.get("owner_id")),text(trigger.get("workflow_id")));jdbc.update("UPDATE workflow_triggers SET last_triggered_at=?,updated_at=? WHERE id=?",now(),now(),trigger.get("id"));return result;}

    @GetMapping("/integrations/dify") Map<String,Object> difyImports(){return Map.of("imports",dify.list(user.ownerId()));}
    @PostMapping("/integrations/dify") Map<String,Object> importDify(@RequestBody Map<String,Object> body){return dify.importYaml(user.ownerId(),text(body.get("yaml")),text(body.get("projectId")),text(body.get("projectSourceId")),text(body.get("name")));}
    @PostMapping(value="/integrations/dify/import",consumes="multipart/form-data") Map<String,Object> uploadDify(@RequestPart("file") MultipartFile file,@RequestParam String projectId,@RequestParam String projectSourceId,@RequestParam(required=false,defaultValue="") String name){try{return dify.importYaml(user.ownerId(),new String(file.getBytes(),java.nio.charset.StandardCharsets.UTF_8),projectId,projectSourceId,name);}catch(ApiException error){throw error;}catch(Exception error){throw new ApiException(HttpStatus.BAD_REQUEST,"Dify 文件读取失败");}}

    @GetMapping("/mcp") Map<String,Object> mcpInfo(){return Map.of("name","threadbeacon","protocolVersion","2025-03-26","transport","streamable-http","tools",List.of("threadbeacon_list_records","threadbeacon_run_workflow","threadbeacon_get_workflow_run","threadbeacon_list_skills","threadbeacon_run_skill"));}
    @PostMapping("/mcp") Map<String,Object> mcp(@RequestBody Map<String,Object> request){return mcpService.handle(request);}
}
