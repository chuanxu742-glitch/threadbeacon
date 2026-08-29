package com.threadbeacon.control.geo;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.job.JobService;
import com.threadbeacon.control.node.NodeService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.InetAddress;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.*;

@Service
public class GeoService {
    private final JdbcTemplate jdbc;private final TransactionTemplate transactions;private final ObjectMapper mapper;private final NodeService nodes;private final JobService jobs;
    public GeoService(JdbcTemplate jdbc,TransactionTemplate transactions,ObjectMapper mapper,NodeService nodes,JobService jobs){this.jdbc=jdbc;this.transactions=transactions;this.mapper=mapper;this.nodes=nodes;this.jobs=jobs;}

    public Map<String,Object> capabilities(){return Map.of("ready",nodes.geoReady(),"capabilities",List.of(Map.of("id","official-site.observe","version","1.0.0","output_schema_version","1.0.0","required_profile_kind","anonymous","artifacts",List.of("trace"))));}

    public Submission submit(String ownerId,Map<String,Object> body){
        var requestId=required(body,"request_id");var idempotencyKey=required(body,"idempotency_key");var capability=object(body.get("capability"));var input=object(body.get("input"));var target=required(input,"url");
        if(!"official-site.observe".equals(text(capability.get("id")))||!"1.0.0".equals(text(capability.get("version")))||!"1.0.0".equals(text(body.get("output_schema_version"))))throw new ApiException(HttpStatus.BAD_REQUEST,"GEO 能力或版本不受支持");
        validatePublicHttps(target);var requiredArtifacts=strings(body.get("required_artifacts"));if(requiredArtifacts.stream().anyMatch(value->!value.equals("trace")))throw new ApiException(HttpStatus.BAD_REQUEST,"required_artifacts 当前只支持 trace");var geoRefs=object(body.get("geo_refs"));
        var normalized=new LinkedHashMap<String,Object>();normalized.put("requestId",requestId);normalized.put("capabilityId","official-site.observe");normalized.put("capabilityVersion","1.0.0");normalized.put("outputSchemaVersion","1.0.0");normalized.put("url",target);normalized.put("requiredArtifacts",requiredArtifacts);normalized.put("geoRefs",geoRefs);var fingerprint=hash(json(mapper,normalized));
        var existing=jdbc.queryForList("SELECT * FROM geo_acquisition_executions WHERE owner_id=? AND idempotency_key=?",ownerId,idempotencyKey);if(!existing.isEmpty()){if(!fingerprint.equals(text(existing.get(0).get("fingerprint"))))throw new ApiException(HttpStatus.CONFLICT,"幂等键已用于不同请求");return new Submission(false,view(existing.get(0)));}
        if(!nodes.geoReady())throw new ApiException(HttpStatus.CONFLICT,"没有通过匿名证明且在线的 GEO Worker");
        return transactions.execute(status->{var executionId=id();var timestamp=now();jdbc.update("""
            INSERT INTO geo_acquisition_executions(id,owner_id,request_id,idempotency_key,fingerprint,status,required_artifacts_json,geo_refs_json,created_at,updated_at)
            VALUES(?,?,?,?,?,'accepted',?,?,?,?)
            """,executionId,ownerId,requestId,idempotencyKey,fingerprint,json(mapper,requiredArtifacts),json(mapper,geoRefs),timestamp,timestamp);
            var managed=Map.of("executionId",executionId,"requestId",requestId,"idempotencyKey",idempotencyKey,"geoRefs",geoRefs,"requiredArtifacts",requiredArtifacts);var job=jobs.insert(ownerId,Map.of("platform","geo","keyword",target,"limit",1,"includeComments",false),Map.of("capability","official-site.observe@1.0.0","url",target,"requiredArtifacts",requiredArtifacts,"managedAcquisition",managed));jdbc.update("UPDATE geo_acquisition_executions SET job_id=?,status='queued',updated_at=? WHERE id=?",job.get("id"),timestamp,executionId);return new Submission(true,view(jdbc.queryForMap("SELECT * FROM geo_acquisition_executions WHERE id=?",executionId)));});
    }

    public Map<String,Object> get(String ownerId,String executionId){var rows=jdbc.queryForList("SELECT * FROM geo_acquisition_executions WHERE id=? AND owner_id=?",executionId,ownerId);if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"GEO 执行不存在");return view(rows.get(0));}
    public Map<String,Object> cancel(String ownerId,String executionId){var timestamp=now();var changed=jdbc.update("UPDATE geo_acquisition_executions SET status='cancelled',cancel_requested_at=?,finished_at=?,updated_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND owner_id=? AND status NOT IN ('succeeded','failed','cancelled')",timestamp,timestamp,timestamp,executionId,ownerId);if(changed!=1)throw new ApiException(HttpStatus.CONFLICT,"GEO 执行无法取消");jdbc.update("UPDATE jobs SET status='cancelled',finished_at=?,updated_at=?,assigned_node_id=NULL WHERE id=(SELECT job_id FROM geo_acquisition_executions WHERE id=?) AND status IN ('queued','running')",timestamp,timestamp,executionId);return get(ownerId,executionId);}

    private Map<String,Object> view(Map<String,Object> row){var result=new LinkedHashMap<String,Object>();for(var key:List.of("id","request_id","idempotency_key","job_id","status","trace_ref","attempt","heartbeat_at","lease_expires_at","started_at","finished_at","created_at","updated_at"))result.put(key,row.get(key));result.put("required_artifacts",parse(mapper,row.get("required_artifacts_json"),List.of()));result.put("geo_refs",parse(mapper,row.get("geo_refs_json"),Map.of()));result.put("result",parse(mapper,row.get("result_json"),null));result.put("failure",parse(mapper,row.get("failure_json"),null));result.put("artifact_refs",parse(mapper,row.get("artifact_refs_json"),List.of()));return result;}
    private String required(Map<String,Object> body,String key){var value=text(body.get(key));if(value.isBlank()||value.length()>500)throw new ApiException(HttpStatus.BAD_REQUEST,key+" 无效");return value;}
    private void validatePublicHttps(String value){try{var uri=URI.create(value);if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw new IllegalArgumentException();for(var address:InetAddress.getAllByName(uri.getHost()))if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isSiteLocalAddress())throw new IllegalArgumentException();}catch(Exception error){throw new ApiException(HttpStatus.BAD_REQUEST,"input.url 必须是公网 HTTPS URL");}}
    public record Submission(boolean created,Map<String,Object> execution){}
}
