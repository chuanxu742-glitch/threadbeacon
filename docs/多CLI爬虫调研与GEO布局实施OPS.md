# ThreadBeacon 多 CLI 爬虫调研与 GEO 布局实施 OPS

## 0. 实施目标

本 OPS 将 `docs/多CLI爬虫调研与GEO布局平台PRD.md` 转换为可执行工程任务。交付结果必须是可运行、可审计、可测试、可运维的正式能力，覆盖：

- Pi、Codex、Claude Code、OpenCode Runtime Adapter。
- DeepSeek 等模型 Provider 与 Runtime 的正交组合。
- CLI 发现、健康、能力上报、任务调度、流式事件和结构化输出。
- 爬虫调研任务、证据落库、Finding 关联和报告输出。
- GEO 项目、Query Set、观测、指标、差距与内容布局产物。
- 控制面、Worker、前端、迁移、部署、测试和运维文档。

## 1. 现有基线

### 1.1 当前仓库可复用能力

| 能力 | 位置 | 复用方式 |
|---|---|---|
| Worker 能力发现与心跳 | `src/worker.ts` | 扩展 RuntimeManifest 和并发资源上报 |
| 数据 Provider 契约 | `src/providers/types.ts` | 保留 `SourceItem` 和 provenance，新增 Observation/Evidence 版本 |
| OpenCLI 动态目录 | `src/providers/opencli.ts` | 作为 CLI Agent 可调用的受管采集工具 |
| 通用 Web 安全 | `src/providers/generic-web.ts` | 复用 SSRF、DNS、robots 和重定向保护 |
| Browser/CDP 动作 | `src/browser-automation/` | 暴露只读浏览器工具，写动作继续走确认 |
| Agent Skill 状态机 | `src/skill-agent.ts` | 复用审批与审计思想，不把现有单模型循环硬扩成多 CLI |
| Worker 租约与控制面 | `apps/control-api` | 新增 Runtime Run 领域对象和领取接口 |
| GEO 官网观测 | `src/geo/official-site.ts`、`docs/GEO.md` | 作为 GEO Observation 的一个 Surface |
| 管理台 | `apps/control-plane` | 新增 GEO 与 Runtime 产品页，遵守现有导航和样式体系 |

### 1.2 参考项目采用的设计

从 `E:\myide\opencli-Razormind` 采用以下成熟边界：

1. Runtime Adapter 是进程和协议契约，不是框架 Python import。
2. Runtime 原生事件映射到闭合事件集合。
3. Worker 只上报实际存在且健康的 Runtime。
4. 任务输入、输出和状态使用版本化 JSON Schema 校验，错误关闭。
5. 权限 Profile 独立于 Runtime Profile。
6. 自动执行必须通过受治理网关，不能给外部 Agent 管理员旁路。
7. 任意 CLI 二进制默认拒绝，管理员配置精确 allowlist。
8. 子进程超时或取消时回收整个进程树。

不复制参考项目的 Python/FastAPI 领域实现；当前仓库继续使用 TypeScript Worker + Spring Boot Control Plane。

## 2. 架构决策

### AD-01：Runtime 与 Provider 分离

`runtimeType` 仅允许 `pi | codex | claude-code | opencode`。`modelProvider` 独立保存为 `openai | anthropic | deepseek | openai-compatible | runtime-login`。DeepSeek 不作为 Runtime 枚举。

### AD-02：闭合标准事件

所有 Adapter 只能输出 `RuntimeEventV1` 中的事件。原生事件可脱敏保存为 Trace，不允许在业务层根据 Runtime 类型写分支。

### AD-03：任务与结果 Schema

Worker 在启动 Runtime 前校验 `ResearchTaskV1`，Runtime 完成后校验 `ResearchResultV1`。结构化输出不合格时任务失败，保留原始 Trace 供诊断，不能用字符串截取伪造完整结果。

### AD-04：CLI Agent 不是 provenance 终点

Runtime 和模型是“如何研究”；Evidence 的 URL、站点、发布时间、内容哈希和采集工具是“证据来自哪里”。只有 Runtime 名称而没有真实来源的内容不能进入已确认 Finding。

### AD-05：进程隔离和无 Shell 启动

所有 CLI 使用 `spawn/execFile` 参数数组。禁止 `shell: true`、命令字符串拼接和用户自定义二进制。每次运行使用独立目录，环境变量按 Adapter 白名单构造。

### AD-06：Worker 本地凭据

CLI 登录态、模型密钥、OpenCLI 登录态和 Browser Profile 留在 Worker。控制面保存 Runtime Profile 引用、脱敏元数据和能力证明，不接收凭据正文。

### AD-07：权限由 ThreadBeacon 收口

Adapter 必须把 `observe | research | propose` 映射为 CLI 原生权限，并同时施加操作系统/容器边界。CLI 自己的 permission flag 是一层防线，不是唯一防线。

### AD-08：持久化租约与 fencing

Runtime Run 使用数据库租约、attempt 和 fencing token。过期 Worker 的事件和完成回传必须拒绝。恢复时从 ThreadBeacon checkpoint 创建新 attempt；只有 Adapter 声明支持时才恢复 CLI 原生 session。

### AD-09：GEO 实验可复现

每次 GEO Observation 固定 Query Set 版本、Surface、Runtime、模型、市场、语言、Profile、时间和参数。指标只能在兼容实验条件下比较。

### AD-10：外部写动作默认关闭

CLI 可以创建内部 Finding、Brief 和任务草稿。对网站、社媒、代码仓库或其他外部系统的写入继续走动作提案、风险判断、人工确认和审计。

## 3. TypeScript Worker 改造

### 3.1 目录与模块

新增：

```text
src/agent-runtimes/
  types.ts
  events.ts
  schemas.ts
  registry.ts
  process-supervisor.ts
  environment.ts
  trace-redaction.ts
  pi-adapter.ts
  codex-adapter.ts
  claude-code-adapter.ts
  opencode-adapter.ts
src/research-agent/
  task.ts
  result.ts
  prompt.ts
  evidence.ts
  executor.ts
src/geo/
  query-set.ts
  answer-observation.ts
  metrics.ts
  layout-plan.ts
```

允许按现有代码风格调整文件拆分，但领域边界不能并回 `src/worker.ts` 或 `src/skill-agent.ts` 形成单文件分支集合。

### 3.2 RuntimeAdapter 接口

```ts
interface RuntimeAdapter {
  readonly runtimeType: RuntimeType;
  discover(config: RuntimeDiscoveryConfig): Promise<RuntimeManifest | null>;
  validateProfile(profile: RuntimeProfile): readonly string[];
  invoke(task: RuntimeInvocation, signal: AbortSignal): AsyncIterable<RuntimeEventV1>;
}
```

`discover` 必须验证二进制存在、版本可解析、版本范围兼容和必要机器模式可用。不能因为 PATH 中出现同名命令就上报 ready。

### 3.3 ProcessSupervisor

统一负责：

- argv-only spawn。
- Windows Job Object 或 `taskkill /T /F` 等价进程树回收；POSIX 使用独立 process group。
- timeout、AbortSignal、stdout/stderr/单行/总 Trace 上限。
- cwd 和 artifact 目录创建、权限设置与清理。
- 退出码、信号、启动失败和协议错误分类。
- 环境变量 allowlist、敏感值遮罩和日志脱敏。
- stdin 关闭、流背压和非 UTF-8 安全处理。

禁止 Adapter 各自实现不同的超时和 kill 逻辑。

### 3.4 Adapter 参数基线

#### Pi

- 启动：`pi --mode rpc --no-session`。
- `observe/research` 禁用项目扩展、Skills、Prompt Templates 和写工具。
- 使用严格 LF JSONL parser，不依赖会把 Unicode 分隔符当换行的通用 readline 行为。
- 映射文本、工具调用、工具结果、usage、settled 和错误。

#### Codex

- 启动：`codex exec --json --ephemeral --sandbox read-only`。
- 使用受管 `CODEX_HOME`，不得默认读取用户任意 MCP、规则和项目配置；允许的 MCP 由 ThreadBeacon 生成。
- 传入 `--output-schema` 和结果文件路径。
- 映射 thread、turn、item、usage、error；记录 thread id 用于显式恢复。

#### Claude Code

- 启动：`claude -p --output-format stream-json --restricted`。
- 使用受管 settings、工具 allowlist、轮次与预算限制。
- 传入 `--json-schema`，流式事件与最终结构化结果分别处理。
- 禁止 `--dangerously-skip-permissions`。

#### OpenCode

- 批任务使用 `opencode run --format json`；需要稳定双向会话时使用 `opencode acp`。
- 使用受管 `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR`，权限中 `edit/write/bash/task` 默认 deny。
- 使用 `--model`、`--agent`、`--dir` 和明确的 permission 配置。
- 禁止自动分享 Session。

### 3.5 Worker 能力上报

心跳 `runtime_json` 新增：

```json
{
  "agentRuntimes": [
    {
      "runtimeId": "codex",
      "adapterVersion": "1.0.0",
      "detectedVersion": "x.y.z",
      "protocol": "jsonl",
      "health": "ready",
      "capabilities": {},
      "models": [],
      "lastCheckedAt": "ISO-8601"
    }
  ]
}
```

`capabilities_json` 同时增加 `agent-runtime:pi`、`agent-runtime:codex`、`agent-runtime:claude-code`、`agent-runtime:opencode` 和 `research-agent`。Runtime 不健康时下次心跳撤下对应 capability。

### 3.6 Worker 执行循环

新增独立 Runtime Slot，不与普通来源任务、Browser Action Slot 或现有 Skill Slot 竞争同一个隐式判断分支：

1. Claim Runtime Run。
2. 校验 Worker capability 与 Runtime Profile。
3. 创建 attempt workspace。
4. 启动 Adapter 并批量回传标准事件。
5. Evidence 事件即时规范化并去重。
6. 定期续租和保存 checkpoint。
7. 完成后校验结果 Schema 并回传 artifact manifest。
8. 取消、失败或超时后回收进程树并回报错误分类。

## 4. Spring Boot 控制面改造

### 4.1 数据迁移

新增 `V5__research_runtime_geo.sql`，包含：

- `runtime_profiles`
- `runtime_profile_project_bindings`
- `research_runs`
- `research_run_attempts`
- `research_run_events`
- `research_evidence`
- `research_findings`
- `finding_evidence_links`
- `observation_versions`
- `geo_projects`
- `geo_query_sets`
- `geo_queries`
- `geo_observations`
- `geo_answer_citations`
- `geo_layout_plans`
- `geo_layout_items`

要求：

- Workspace/owner 隔离。
- 状态 CHECK constraint。
- 幂等键和 attempt fencing 唯一约束。
- Findings、Evidence、Project、Run、Workflow 之间有真实外键。
- Query Set 发布后不可变；新修改创建新版本。
- Observation 不覆盖，使用版本表保存每次观测。
- 大对象只保存 S3 key、hash、mime、size 和 schema version。

### 4.2 状态机

Research Run：

```text
draft → queued → leased → running → validating → completed
                    ↘ awaiting_approval
                    ↘ retry_wait → queued
                    ↘ failed / cancelled
```

GEO Observation 复用 Research Run 执行层，但保留独立实验元数据和指标投影。

### 4.3 API

用户 API：

```text
GET/POST/PATCH  /api/runtime-profiles
POST            /api/runtime-profiles/{id}/test
GET/POST        /api/research/projects/{projectId}/runs
GET              /api/research/runs/{runId}
POST             /api/research/runs/{runId}/cancel
GET              /api/research/runs/{runId}/events
GET/PATCH        /api/research/findings/{findingId}
GET/POST/PATCH   /api/geo/projects
GET/POST         /api/geo/projects/{id}/query-sets
POST             /api/geo/query-sets/{id}/publish
POST             /api/geo/projects/{id}/observations
GET              /api/geo/projects/{id}/dashboard
POST             /api/geo/projects/{id}/layout-plans
```

Worker API：

```text
POST /api/worker/research/claim
POST /api/worker/research/{runId}/heartbeat
POST /api/worker/research/{runId}/events
POST /api/worker/research/{runId}/checkpoint
POST /api/worker/research/{runId}/complete
POST /api/worker/research/{runId}/fail
```

所有 Worker 写接口验证 node identity、lease token、attempt 和 fencing token。

### 4.4 领域服务

按职责拆分：

- `RuntimeProfileService`
- `ResearchRunService`
- `ResearchEvidenceService`
- `ResearchFindingService`
- `GeoProjectService`
- `GeoObservationService`
- `GeoMetricsService`
- `GeoLayoutService`

不要继续把新领域逻辑堆进 `PlatformService`、`JobService` 或 `SystemController`。

## 5. 数据与证据处理

### 5.1 SourceItem 扩展

保持现有 `SourceItem` 兼容，新增独立 Observation Envelope：

```ts
interface ObservationEnvelopeV1 {
  observationId: string;
  projectId: string;
  runId: string;
  sourceItem: SourceItem;
  provenance: Provenance;
  observedAt: string;
  contentHash: string;
  canonicalUrl?: string;
  previousObservationId?: string;
  changeType: 'created' | 'updated' | 'unchanged' | 'deleted' | 'unknown';
  artifactRefs: ArtifactRef[];
}
```

### 5.2 Evidence 入库规则

- URL canonicalization 不能移除影响内容身份的参数。
- 正文与摘录分别保存 hash。
- 原文快照受版权、大小和来源策略限制；不能默认保存整页永久副本。
- Evidence 记录 Runtime、模型、工具和 Provider，但这些字段不能替代真实来源。
- Citation 必须引用 Evidence ID，禁止只保存 Agent 自由文本中的脚注序号。
- Finding 状态：`proposed | verified | disputed | rejected | superseded`。
- 置信表达基于证据覆盖、独立来源、时间一致性与冲突状态，不仅依据样本数量。

## 6. GEO 计算与布局生成

### 6.1 Observation 输入

- Query Set version。
- Surface 类型和版本。
- Runtime/Profile/Model。
- 市场、语言、地区与时间窗口。
- 品牌和竞品实体词典。
- 答案文本、引用 URL、引用顺序和抓取 Trace。

### 6.2 指标计算

实现 PRD 定义的 Query Coverage、Brand Mention Rate、Citation Rate、Owned Citation Share、Competitive Citation Share、Position Distribution、Topic Authority Coverage、Evidence Freshness 和 Volatility。

每个指标返回：

- numerator / denominator。
- 样本量。
- 兼容实验条件。
- 置信说明与缺失原因。
- 与上一个兼容基线的绝对变化和相对变化。

### 6.3 Layout Plan

Agent 生成内容布局时输入必须包含：

- 已验证 GEO Observation。
- 竞品引用页面和品牌现有页面。
- 用户问题与内容意图。
- 来源覆盖、冲突和新鲜度。

输出使用 `geo.layout-plan.v1`，包含 topic、audience、intent、gap、recommendedAsset、targetQueries、requiredEvidence、distributionChannels、priority、effort、owner、acceptanceCriteria、retestAt 和 evidenceIds。

没有 Evidence ID 的建议必须标记为探索项，不能进入已批准执行计划。

## 7. 前端交付

### 7.1 Runtime 管理

在“团队与系统”新增 Agent Runtimes：

- Runtime 状态表：名称、Worker、版本、协议、模型、健康、并发、最近错误。
- Runtime Profile 编辑：Runtime、Provider、模型、推理、权限、工具、项目范围和预算。
- 连接测试结果：二进制、版本、认证、结构化输出、网络工具和权限检查。
- 不展示密钥正文或完整 CLI 用户配置。

### 7.2 调研项目

- 研究目标与实体配置。
- 来源计划和查询计划。
- Runtime 策略选择。
- 运行 Trace、查询、工具调用和费用。
- Records、Observation 版本、Finding、Evidence、冲突和复核。
- 可阅读报告，不以原始 JSON 卡片作为主要结果。

### 7.3 GEO 布局

- 品牌与竞品配置。
- Query Set 编辑、发布和版本历史。
- 可见性趋势、主题覆盖矩阵、引用来源表和竞品差距。
- Query 级答案与 Citation 检查器。
- 内容布局看板与 Brief 详情。
- 基线选择和复测对比。

### 7.4 设计约束

- 延续现有管理台视觉语言和 `AppNav`。
- 操作型界面保持紧凑、可扫描，不使用营销 Hero、装饰性渐变或大面积卡片套卡片。
- 图标使用项目现有库；没有库时先检查依赖，不手绘重复图标。
- 所有空态、错误态、加载态、权限态、无 Runtime 态和版本不兼容态完整可用。
- 桌面与移动视口无文本溢出、控件跳动或内容重叠。

## 8. 配置与部署

### 8.1 环境变量

新增配置应优先通过一个只读 Runtime 配置文件声明，环境变量只保存路径和敏感引用：

```text
THREADBEACON_RUNTIME_CONFIG=/etc/threadbeacon/runtimes.json
THREADBEACON_RUNTIME_WORK_ROOT=/var/lib/threadbeacon/runtime-runs
THREADBEACON_RUNTIME_TRACE_MAX_BYTES=16777216
THREADBEACON_RUNTIME_STDERR_MAX_BYTES=2097152
THREADBEACON_RUNTIME_DEFAULT_TIMEOUT_SECONDS=900
THREADBEACON_RUNTIME_MAX_CONCURRENCY=4
```

`runtimes.json` 由管理员管理，包含精确二进制路径、版本范围、受管配置目录和允许的 Provider Profile 引用。API 不提供修改二进制路径的接口。

### 8.2 容器与本机

- Docker Worker 镜像可以按 Runtime 提供扩展镜像，不把四个 CLI 强制打进基础镜像。
- 本机 Worker 支持复用用户已登录 CLI，但必须使用受管配置或明确授权的登录 Profile。
- 远程 Worker 继续通过 outbound polling 或 WSS Gateway；控制面不得反向读取用户主目录。
- GEO 匿名 Profile 与登录采集 Profile 保持资源隔离。

## 9. 测试矩阵

### 9.1 单元测试

- 每个 Adapter 的版本解析、argv、env、事件映射、Schema 校验和错误映射。
- ProcessSupervisor 的超时、取消、进程树回收、输出截断和敏感信息遮罩。
- Runtime Registry 的发现、能力撤下和版本不兼容。
- ResearchTask/Result/Evidence Schema。
- Observation change detection。
- GEO 指标、兼容基线和波动计算。
- Layout Plan 的 Evidence 完整性。

使用 fake CLI fixtures 模拟 JSONL/stream-json/ACP，不要求单元测试消耗真实模型额度。

### 9.2 集成测试

- Worker 注册四类 RuntimeManifest。
- 控制面按 Runtime capability 派发并验证租约。
- 事件批量回传、乱序拒绝、重复幂等和过期 fencing 拒绝。
- 取消后进程树回收。
- ResearchResult 入库生成 Evidence/Finding 关系。
- GEO Query Set 发布不可变和复测对比。
- Workspace 越权、凭据泄漏和日志脱敏测试。

### 9.3 真实验收

在具备合法账号和网络条件的专用 Worker 上分别执行：

1. Pi + 一个可用 Provider。
2. Codex + OpenAI 或用户已登录账号。
3. Claude Code + Anthropic 或 DeepSeek Provider。
4. OpenCode + DeepSeek Provider。

每次验收使用同一个公开研究题目和固定 Schema，保存 Runtime 版本、费用、Trace、Evidence 和结果差异。未完成真实验收的 Runtime 在兼容矩阵标记“实现完成，凭据验收待完成”，不能标记为真实可用。

### 9.4 前端验收

- Playwright 覆盖 Runtime 配置、调研运行、Finding 复核、Query Set 发布、GEO Dashboard 和 Layout Brief。
- 截图检查桌面和移动视口。
- 验证 Runtime 掉线、无权限、预算耗尽、Schema 错误和取消状态。

## 10. 上线闸门

上线前必须全部满足：

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm control:java:check`
4. `pnpm control:lint`
5. `pnpm control:build`
6. 数据迁移在空库和现有库快照上通过。
7. 备份恢复包含新增表和 S3 artifacts。
8. Secret 扫描确认 Trace、日志、数据库和前端 bundle 无凭据。
9. 四个 fake CLI 合约测试通过。
10. 至少两个真实 Runtime 完成联网验收，其余 Runtime 状态如实展示。
11. GEO 指标通过固定 fixture 的可重复计算。
12. README、`.env.example`、兼容矩阵、Docker、自托管、故障排查和升级文档同步更新。

## 11. 实施顺序

### 交付批次 A：领域契约与执行内核

- Runtime/Event/Task/Result/Evidence Schema。
- ProcessSupervisor、Registry 和四个 Adapter。
- Fake CLI 合约测试与 Worker capability 上报。

### 交付批次 B：持久化控制面与运行闭环

- V5 迁移、Runtime Profile、Research Run、Worker API、租约、取消和恢复。
- Worker Runtime Slot 和事件/结果回传。
- Evidence、Finding、Observation Version 投影。

### 交付批次 C：GEO 观测与布局

- GEO Project、Query Set、Observation、Citation 和指标。
- Layout Plan、Brief、证据约束和复测比较。
- 现有 `official-site.observe` 纳入统一 GEO 项目。

### 交付批次 D：产品界面与运维收口

- Runtime 管理、调研项目、证据复核、GEO Dashboard 和布局看板。
- 配置、部署、备份、故障排查、兼容矩阵和真实验收记录。
- 全量工程检查和浏览器验收。

各批次可以分提交完成，但主分支交付时不得保留虚假按钮、静态示例数据、无执行后端的页面或与真实能力不一致的 ready 状态。

## 12. 完成定义

工程完成必须同时满足：

- 产品流程从 Runtime 发现、研究任务、真实 Evidence、Finding 复核到 GEO 布局可完整运行。
- 四个 Runtime Adapter 有正式协议实现与测试，不是统一文本输出包装器。
- DeepSeek 作为 Provider 与 Runtime 解耦。
- 数据模型支持不可变观测、基线变化和证据关系。
- GEO 指标可解释、可复现并显示实验上下文。
- 所有安全边界以代码和测试执行，不只写在提示词或文档中。
- 运维人员能安装、诊断、升级、撤下 Runtime 并恢复失败任务。
- 用户能在管理台理解研究结果和 GEO 行动，不需要阅读原始 JSON。

