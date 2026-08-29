package com.threadbeacon.control.integration;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.platform.PlatformService;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;

import static com.threadbeacon.control.common.Values.*;

@Service
public class DifyImportService {
    private static final int MAX_BYTES = 1_048_576;
    private static final Set<String> BLOCKED = Set.of("code", "tool", "plugin", "agent", "iteration", "loop");
    private static final Map<String,String> MAPPINGS = Map.ofEntries(
            Map.entry("start", "source"), Map.entry("end", "report"), Map.entry("answer", "deliver"),
            Map.entry("llm", "llm"), Map.entry("if-else", "gate"), Map.entry("question-classifier", "gate"),
            Map.entry("template-transform", "normalize"), Map.entry("template", "normalize"),
            Map.entry("variable-aggregator", "normalize"), Map.entry("parameter-extractor", "normalize"),
            Map.entry("document-extractor", "normalize"), Map.entry("knowledge-retrieval", "dataset"));
    private static final Pattern SENSITIVE = Pattern.compile("(?:^|[-_])(password|passwd|secret|token|api[-_]?key|authorization|cookie|credential)(?:$|[-_])", Pattern.CASE_INSENSITIVE);
    private final JdbcTemplate jdbc;
    private final PlatformService platform;
    private final ObjectMapper jsonMapper;
    private final ObjectMapper yamlMapper = new ObjectMapper(YAMLFactory.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build());

    public DifyImportService(JdbcTemplate jdbc, PlatformService platform, ObjectMapper jsonMapper) {
        this.jdbc = jdbc; this.platform = platform; this.jsonMapper = jsonMapper;
    }

    public Map<String,Object> importYaml(String ownerId, String yaml, String projectId, String projectSourceId, String requestedName) {
        if (yaml == null || yaml.isBlank() || yaml.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES || yaml.indexOf('\0') >= 0)
            throw new ApiException(HttpStatus.BAD_REQUEST, "Dify YAML 必须是 1 字节到 1 MiB");
        var projects=jdbc.queryForList("SELECT id FROM projects WHERE id=? AND owner_id=?",projectId,ownerId);
        var sources=jdbc.queryForList("SELECT * FROM project_sources WHERE id=? AND project_id=? AND owner_id=?",projectSourceId,projectId,ownerId);
        if(projects.isEmpty()||sources.isEmpty())throw new ApiException(HttpStatus.BAD_REQUEST,"目标项目或绑定数据源不存在");
        Map<String,Object> parsed;
        try { parsed=object(yamlMapper.readValue(yaml, Object.class)); }
        catch(Exception error){throw new ApiException(HttpStatus.BAD_REQUEST,"Dify YAML 解析失败："+safe(error.getMessage()));}
        var app=object(parsed.get("app"));var mode=text(app.get("mode"));
        if(!Set.of("workflow","advanced-chat").contains(mode))throw new ApiException(HttpStatus.BAD_REQUEST,"仅支持 Dify workflow 与 advanced-chat DSL");
        var graph=object(object(parsed.get("workflow")).get("graph"));var rawNodes=array(graph.get("nodes"));var rawEdges=array(graph.get("edges"));
        if(rawNodes.isEmpty()||rawNodes.size()>30||rawEdges.size()>60)throw new ApiException(HttpStatus.BAD_REQUEST,"Dify 节点必须为 1-30 个，连线最多 60 条");

        var sourceRow=sources.get(0);var sourceStored=parseJson(text(sourceRow.get("config_json")));var sourceConfig=new LinkedHashMap<String,Object>();
        var kind=text(sourceRow.get("kind"));var platformName=Set.of("rss","rest","web").contains(kind)?kind:text(sourceStored.get("platform"));
        if(platformName.isBlank())platformName="web";sourceConfig.put("platform",platformName);sourceConfig.put("keyword",text(sourceStored.get("keyword")).isBlank()?"Dify 导入工作流":text(sourceStored.get("keyword")));sourceConfig.put("limit",100);sourceConfig.put("includeComments",true);sourceConfig.put("projectSourceId",projectSourceId);

        var used=new HashSet<String>();var idMap=new LinkedHashMap<String,String>();var nodes=new ArrayList<Map<String,Object>>();var issues=new ArrayList<Map<String,Object>>();int starts=0;
        for(int index=0;index<rawNodes.size();index++){
            var item=object(rawNodes.get(index));var data=object(item.get("data"));var original=text(item.get("id"));if(original.isBlank())original="missing-"+(index+1);if(idMap.containsKey(original))throw new ApiException(HttpStatus.BAD_REQUEST,"Dify 节点 ID 重复："+original);
            var nodeType=text(data.get("type")).toLowerCase(Locale.ROOT);if(nodeType.isBlank())nodeType=text(item.get("type")).toLowerCase(Locale.ROOT);if(nodeType.isBlank())throw new ApiException(HttpStatus.BAD_REQUEST,"Dify 节点缺少类型");
            var nodeId=safeNodeId(original,index,used);idMap.put(original,nodeId);if("start".equals(nodeType))starts++;
            var status=BLOCKED.contains(nodeType)?"blocked":MAPPINGS.containsKey(nodeType)?"supported":"requires-review";var mapped="supported".equals(status)?MAPPINGS.get(nodeType):"gate";
            var message="supported".equals(status)?nodeType+" 已映射到 ThreadBeacon 托管节点":("blocked".equals(status)?nodeType+" 依赖任意代码、插件或工具执行，已阻断":"未知节点已按人工闸门导入，发布前必须复核");
            issues.add(Map.of("nodeId",original,"nodeType",nodeType,"status",status,"message",message));
            var config=new LinkedHashMap<>(object(redact(data,0)));if("source".equals(mapped))config.putAll(sourceConfig);config.put("difyNodeId",original);config.put("difyNodeType",nodeType);config.put("compatibilityStatus",status);if(!"supported".equals(status))config.put("blockedByCompatibility",true);
            var node=new LinkedHashMap<String,Object>();node.put("id",nodeId);node.put("type",mapped);node.put("label",limit(text(data.get("title")).isBlank()?nodeType:text(data.get("title")),80));node.put("x",60+index*180);node.put("y",110);node.put("config",config);nodes.add(node);
        }
        if(starts<1||starts>10)throw new ApiException(HttpStatus.BAD_REQUEST,"Dify 工作流必须包含 1-10 个 start 节点");
        var edges=new ArrayList<Map<String,Object>>();for(int index=0;index<rawEdges.size();index++){var edge=object(rawEdges.get(index));var from=idMap.get(text(edge.get("source")));var target=idMap.get(text(edge.get("target")));if(from==null||target==null||from.equals(target))throw new ApiException(HttpStatus.BAD_REQUEST,"Dify 连线引用了无效节点");edges.add(Map.of("id","dify-edge-"+(index+1),"source",from,"target",target));}
        var spec=new LinkedHashMap<String,Object>();spec.put("source",sourceConfig);spec.put("sources",List.of(sourceConfig));spec.put("steps",nodes.stream().map(node->text(node.get("type"))).filter(type->!"source".equals(type)).distinct().toList());spec.put("nodes",nodes);spec.put("edges",edges);
        var blocked=issues.stream().filter(issue->"blocked".equals(issue.get("status"))).count();var review=issues.stream().filter(issue->"requires-review".equals(issue.get("status"))).count();var sanitized=redact(parsed,0);var sourceHash=sha256(json(jsonMapper,sanitized));
        var report=new LinkedHashMap<String,Object>();report.put("mode",mode);report.put("sourceHash",sourceHash);report.put("totalNodes",nodes.size());report.put("supportedNodes",nodes.size()-blocked-review);report.put("reviewNodes",review);report.put("blockedNodes",blocked);report.put("executable",blocked==0&&review==0);report.put("issues",issues);report.put("nodeIdMap",idMap);report.put("disclaimer","仅导入受管控节点语义；任意代码、工具和插件不会执行。");
        var requested=requestedName==null?"":requestedName;var name=limit(requested.isBlank()?text(app.get("name")):requested,80);if(name.isBlank())name="Dify 导入工作流";
        var workflow=platform.createWorkflow(ownerId,Map.of("projectId",projectId,"name",name,"description",limit(text(app.get("description")),500),"spec",spec));var importId=id();
        jdbc.update("INSERT INTO compatibility_imports(id,owner_id,project_id,workflow_id,kind,source_hash,source_json,report_json,created_at) VALUES(?,?,?,?, 'dify',?,?,?,?)",importId,ownerId,projectId,workflow.get("id"),sourceHash,json(jsonMapper,sanitized),json(jsonMapper,report),now());
        return Map.of("workflow",workflow,"importId",importId,"report",report);
    }

    public List<Map<String,Object>> list(String ownerId){return jdbc.queryForList("SELECT id,project_id,workflow_id,kind,source_hash,report_json,created_at FROM compatibility_imports WHERE owner_id=? AND kind='dify' ORDER BY created_at DESC LIMIT 100",ownerId);}
    private Map<String,Object> parseJson(String value){try{return object(jsonMapper.readValue(value,Object.class));}catch(Exception ignored){return Map.of();}}
    private Object redact(Object value,int depth){if(depth>20)return "[truncated]";if(value instanceof List<?> list)return list.stream().limit(500).map(item->redact(item,depth+1)).toList();if(!(value instanceof Map<?,?> map))return value;var out=new LinkedHashMap<String,Object>();int count=0;for(var entry:map.entrySet()){if(count++>=1000)break;var key=text(entry.getKey());out.put(key,SENSITIVE.matcher(key).find()?"[redacted]":redact(entry.getValue(),depth+1));}return out;}
    private String safeNodeId(String original,int index,Set<String> used){var normalized=original.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-]","-").replaceAll("-+","-").replaceAll("^-|-$","");var candidate=normalized.matches("^[a-z][a-z0-9-]{1,63}$")?normalized:"dify-node-"+(index+1);var base=limit(candidate,58);for(int suffix=2;used.contains(candidate);suffix++)candidate=base+"-"+suffix;used.add(candidate);return candidate;}
    private String limit(String value,int max){return value==null?"":value.substring(0,Math.min(max,value.length()));}
    private String safe(String value){return limit(value==null?"invalid yaml":value.replaceAll("[\\r\\n]+"," "),300);}
    private String sha256(String value){try{var digest=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));return HexFormat.of().formatHex(digest);}catch(Exception error){throw new IllegalStateException(error);}}
}
