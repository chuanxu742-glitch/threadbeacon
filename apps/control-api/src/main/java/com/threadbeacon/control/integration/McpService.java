package com.threadbeacon.control.integration;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.job.JobService;
import com.threadbeacon.control.platform.PlatformService;
import com.threadbeacon.control.skill.SkillService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.threadbeacon.control.common.Values.integer;
import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

@Service
public class McpService {
    private final CurrentUser user;
    private final JobService jobs;
    private final PlatformService platform;
    private final SkillService skills;
    private final ObjectMapper mapper;

    public McpService(CurrentUser user, JobService jobs, PlatformService platform,
                      SkillService skills, ObjectMapper mapper) {
        this.user = user;
        this.jobs = jobs;
        this.platform = platform;
        this.skills = skills;
        this.mapper = mapper;
    }

    public Map<String, Object> handle(Map<String, Object> request) {
        var id = request.get("id");
        var method = text(request.get("method"));
        try {
            return switch (method) {
                case "initialize" -> response(id, Map.of(
                        "protocolVersion", "2025-03-26",
                        "capabilities", Map.of("tools", Map.of("listChanged", false)),
                        "serverInfo", Map.of("name", "threadbeacon", "version", "1.2.0")
                ));
                case "ping" -> response(id, Map.of());
                case "notifications/initialized" -> Map.of("jsonrpc", "2.0");
                case "tools/list" -> response(id, Map.of("tools", tools()));
                case "tools/call" -> response(id, call(object(request.get("params"))));
                default -> error(id, -32601, "MCP method 不支持：" + method);
            };
        } catch (ApiException denied) {
            return error(id, -32003, denied.getMessage());
        } catch (IllegalArgumentException invalid) {
            return error(id, -32602, invalid.getMessage());
        } catch (Exception failure) {
            return error(id, -32603, "MCP 工具执行失败");
        }
    }

    private Map<String, Object> call(Map<String, Object> params) {
        var name = text(params.get("name"));
        var arguments = object(params.get("arguments"));
        Object value = switch (name) {
            case "threadbeacon_list_records" -> {
                user.requireScope("records:read");
                yield Map.of("records", jobs.records(user.ownerId(), text(arguments.get("search")),
                        text(arguments.get("platform")), integer(arguments.get("limit"), 50),
                        integer(arguments.get("offset"), 0)));
            }
            case "threadbeacon_run_workflow" -> {
                user.requireRole("editor");
                user.requireScope("workflows:run");
                yield platform.run(user.ownerId(), required(arguments, "workflowId"));
            }
            case "threadbeacon_get_workflow_run" -> {
                user.requireScope("runs:read");
                yield platform.runDetails(user.ownerId(), required(arguments, "runId"));
            }
            case "threadbeacon_list_skills" -> {
                user.requireScope("skills:read");
                yield Map.of("skills", skills.list(user.ownerId()));
            }
            case "threadbeacon_run_skill" -> {
                user.requireRole("editor");
                user.requireScope("skills:run");
                var body = new LinkedHashMap<String, Object>();
                body.put("task", required(arguments, "task"));
                body.put("allowlist", arguments.getOrDefault("allowlist", List.of()));
                body.put("maxSteps", integer(arguments.get("maxSteps"), 10));
                yield Map.of("run", skills.startRun(user.ownerId(), required(arguments, "skillId"), body));
            }
            default -> throw new IllegalArgumentException("未知 MCP tool：" + name);
        };
        try {
            var text = mapper.writeValueAsString(value);
            return Map.of(
                    "content", List.of(Map.of("type", "text", "text", text)),
                    "structuredContent", value,
                    "isError", false
            );
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private List<Map<String, Object>> tools() {
        return List.of(
                tool("threadbeacon_list_records", "查询标准化情报记录", Map.of(
                        "type", "object", "properties", Map.of(
                                "search", string(), "platform", string(),
                                "limit", integerSchema(1, 500), "offset", integerSchema(0, 1_000_000)))),
                tool("threadbeacon_run_workflow", "运行已发布工作流", objectSchema("workflowId")),
                tool("threadbeacon_get_workflow_run", "查询工作流运行、检查点和事件", objectSchema("runId")),
                tool("threadbeacon_list_skills", "列出已治理的 Agent Skills", Map.of("type", "object", "properties", Map.of())),
                tool("threadbeacon_run_skill", "启动可审计的 Agent Skill 执行", Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "skillId", string(), "task", string(),
                                "allowlist", Map.of("type", "array", "items", string()),
                                "maxSteps", integerSchema(1, 50)),
                        "required", List.of("skillId", "task"), "additionalProperties", false))
        );
    }

    private Map<String, Object> tool(String name, String description, Map<String, Object> schema) {
        return Map.of("name", name, "description", description, "inputSchema", schema);
    }
    private Map<String, Object> objectSchema(String required) {
        return Map.of("type", "object", "properties", Map.of(required, string()),
                "required", List.of(required), "additionalProperties", false);
    }
    private Map<String, Object> string() { return Map.of("type", "string"); }
    private Map<String, Object> integerSchema(int min, int max) {
        return Map.of("type", "integer", "minimum", min, "maximum", max);
    }
    private String required(Map<String, Object> input, String key) {
        var value = text(input.get(key));
        if (value.isBlank()) throw new IllegalArgumentException(key + " 不能为空");
        return value;
    }
    private Map<String, Object> response(Object id, Object result) {
        var response = new LinkedHashMap<String, Object>();
        response.put("jsonrpc", "2.0"); response.put("id", id); response.put("result", result);
        return response;
    }
    private Map<String, Object> error(Object id, int code, String message) {
        var response = new LinkedHashMap<String, Object>();
        response.put("jsonrpc", "2.0"); response.put("id", id);
        response.put("error", Map.of("code", code, "message", message));
        return response;
    }
}
