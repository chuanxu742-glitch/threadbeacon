# ThreadBeacon 多 CLI 爬虫调研与 GEO 布局平台 PRD

## 文档信息

- 状态：实施基线
- 日期：2026-08-30
- 产品负责人：ThreadBeacon
- 适用仓库：`E:\myide\caiji`
- 参考实现：`E:\myide\opencli-Razormind`
- 关联文档：`docs/产品与架构.md`、`docs/GEO.md`、`docs/行业合规范式.md`、`docs/研究团队版产品优化PRD.md`

## 0. 产品决策

ThreadBeacon 的核心从“研究情报工作流平台”进一步聚焦为：

> 面向增长、品牌、产品与研究团队的开源自托管 AI 爬虫调研与 GEO 布局平台。系统调用用户自备的 Pi、Codex、Claude Code、OpenCode 等 Agent CLI，结合 OpenCLI、公开网页、RSS、官方 API 和授权浏览器，在受治理边界内持续采集证据、完成多步研究、测量品牌在生成式搜索中的可见性，并形成可执行的内容布局方案。

产品对外强调“全网调研、证据研究、GEO 可见性与内容布局”，爬虫、CLI、Worker、CDP 和模型协议是执行能力，不是要求业务用户先理解的产品入口。

### 0.1 核心飞轮

```text
研究目标与品牌实体
        ↓
来源发现与持续采集
        ↓
证据归一化、去重、版本差异
        ↓
多 Agent 深度调研与交叉验证
        ↓
GEO 查询观测、竞品差距、引用来源分析
        ↓
内容主题地图、页面机会、分发任务与优先级
        ↓
人工复核、交付、再次观测
```

### 0.2 三个必须分开的概念

| 概念 | 示例 | 产品职责 |
|---|---|---|
| Agent Runtime | Pi、Codex、Claude Code、OpenCode | 负责计划、工具调用、流式事件和任务状态 |
| Model Provider | OpenAI、Anthropic、DeepSeek、本地 OpenAI-compatible | 负责模型推理、计费和上下文能力 |
| Acquisition Tool | OpenCLI、RSS、REST、Web、Browser/CDP、MCP | 负责真实取数、网页观测和证据提取 |

DeepSeek 在本产品中首先是 Model Provider。用户可以选择 `Codex + DeepSeek`、`Claude Code + DeepSeek`、`Pi + DeepSeek` 或 `OpenCode + DeepSeek`。只有在未来出现具备稳定、可验证机器协议的独立 DeepSeek Agent CLI 时，才新增对应 Runtime Adapter。

## 1. 背景与机会

传统调研产品存在四类断裂：

1. 爬虫只负责取数，无法自主发现来源、追问和修正研究路径。
2. 通用 Agent 能做一次性搜索，但任务、证据、版本、预算和结果难以治理。
3. GEO 工具通常只给品牌提及率或排名，无法解释引用来自哪里、网站为什么没有被引用、下一步应建设什么内容。
4. 团队已经购买或登录 Codex、Claude Code、Pi、OpenCode，却不能把这些本地能力作为自托管研究基础设施复用。

ThreadBeacon 已有 Worker Fleet、平台 Provider、OpenCLI 动态目录、Browser Profile、Skill、DAG、审计、GEO 官网观测和报告基础。本次产品升级把这些能力收束为一条“采集证据到 GEO 布局”的业务主线。

## 2. 目标用户与任务

### 2.1 目标用户

| 用户 | 主要任务 |
|---|---|
| GEO / SEO 负责人 | 持续测量品牌在生成式搜索中的可见性、引用率与内容缺口 |
| 增长与内容团队 | 找到用户真实问题、竞品覆盖空白并生成内容布局任务 |
| 产品经理与战略研究员 | 追踪竞品功能、定价、定位、用户反馈和市场变化 |
| 研究团队负责人 | 管理研究口径、证据质量、预算、复核与交付 |
| 自托管管理员 | 管理 Worker、CLI 登录、模型凭据、浏览器 Profile 和合规边界 |

### 2.2 核心 Job To Be Done

当我要判断一个品牌或产品应该如何布局生成式搜索时，我希望系统能持续搜集官网、社区、内容平台、搜索结果和公开讨论，保留每条结论的出处，比较自己与竞品在哪些问题上被提及和引用，并把差距转化为有优先级的内容建设任务。

## 3. 产品范围

### 3.1 爬虫调研

系统支持从一个研究问题启动完整调研：

1. 定义品牌、竞品、受众、市场、语言、时间范围和研究问题。
2. 发现并确认来源：官网、文档、博客、帮助中心、RSS、论坛、社媒、视频、榜单、公开 API。
3. 选择执行策略：固定 Provider、指定 CLI Runtime，或由调度器按能力、成本和健康度路由。
4. 执行关键词扩展、来源搜索、列表抓取、详情抓取、评论或关联页面抓取。
5. 对采集结果进行字段归一化、内容指纹、实体消歧、跨来源去重和版本差异计算。
6. 由一个或多个 Agent 完成摘要、主题聚类、证据核验、反例查找和结论生成。
7. 研究结论必须连接到可定位的原始证据和运行 Trace。

### 3.2 GEO 可见性观测

每个 GEO 项目包含：

- 品牌实体、产品实体、别名、官网域名和市场语言。
- 竞品集合与对比组。
- 查询主题簇、用户问题、漏斗阶段和意图标签。
- 观测 Surface，例如模型 API 的联网回答、获准使用的 Agent Web Search、公开搜索结果和官网页面。
- 固定查询集与探索查询集。
- 基线运行、周期运行和版本对比。

系统输出：

| 指标 | 定义 |
|---|---|
| Query Coverage | 有有效观测结果的查询占比 |
| Brand Mention Rate | 回答中明确提及品牌的查询占比 |
| Citation Rate | 回答中出现可验证外部引用的查询占比 |
| Owned Citation Share | 引用指向品牌自有域名的占比 |
| Competitive Citation Share | 品牌与竞品在有效引用中的份额 |
| Position Distribution | 品牌首次出现位置的分布，不伪装成单一排名 |
| Topic Authority Coverage | 各主题簇中品牌被提及或引用的覆盖情况 |
| Evidence Freshness | 观测和引用页面的新鲜度 |
| Volatility | 相同查询跨周期、模型或地区的结果波动 |

所有指标同时展示样本量、查询集版本、Surface、模型、地区、语言和观测时间，不能只给一个脱离实验上下文的总分。

### 3.3 GEO 内容布局

“布局”不是承诺操纵模型排名，而是把证据差距转化为可执行建设计划：

1. **主题地图**：品牌、竞品、用户问题、实体、页面和引用域名之间的覆盖关系。
2. **引用来源地图**：哪些第三方域名经常被答案引用，品牌在哪些来源缺席。
3. **内容缺口**：竞品已被引用而品牌缺少权威页面的问题与实体。
4. **页面机会**：应新建、重写、补证据、补结构化信息或加强内部链接的页面。
5. **内容 Brief**：目标问题、意图、受众、应回答的子问题、所需一手证据、参考来源和验收指标。
6. **分发建议**：官网、文档、帮助中心、GitHub、社区和第三方媒体的建议渠道。
7. **任务组合**：按业务价值、证据强度、竞争差距、制作成本和预期复测周期排序。
8. **复测计划**：内容发布后按相同查询集与实验条件重新观测。

默认只生成方案、Brief 和任务，不自动向外部平台发布内容。任何外部写动作必须进入受治理动作网关并由人确认。

## 4. CLI 来源接入设计

### 4.1 接入原则

Agent CLI 可以直接承担来源发现和研究执行，但 CLI 自身不是证据来源。每条证据仍要记录真实 URL、站点、作者、时间、内容哈希、抓取工具和观测时间。

CLI Runtime 只能通过版本化 Adapter 接入，不能让普通用户提交任意二进制、任意参数模板或任意环境变量。

### 4.2 Runtime 支持矩阵

| Runtime | 推荐机器接口 | 输出 | 默认权限 | 会话策略 |
|---|---|---|---|---|
| Pi | `pi --mode rpc --no-session` | JSONL RPC 事件 | 只读工具，禁用项目扩展、写工具和 Shell | 研究任务默认无持久会话；显式研究链可保存受管会话目录 |
| Codex | `codex exec --json --ephemeral` | JSONL 事件 + Output Schema | `read-only` sandbox，隔离 Runner 内允许受控网络工具 | 记录 thread id；需要续跑时显式恢复 |
| Claude Code | `claude -p --output-format stream-json --restricted` | stream-json + JSON Schema | restricted/plan，工具 allowlist | 记录 session id；禁止未经授权的 continue-last |
| OpenCode | `opencode run --format json` 或 `opencode acp` | 原始 JSON 事件或 ACP nd-JSON | 专用 Agent 配置，write/edit/bash 默认 deny | 记录 session id；由受管配置决定是否续跑 |

每个 Adapter 需要独立声明版本范围、传输协议、事件映射、结构化输出能力、会话恢复能力、权限映射和已验证平台。

### 4.3 Runtime 与模型组合

用户配置 Runtime Profile 时选择：

- Runtime：Pi / Codex / Claude Code / OpenCode。
- Model Provider：使用 CLI 当前登录、指定组织托管配置，或 Worker 本地环境中的 Provider Profile。
- Model：由 CLI 原生模型目录返回，不在控制面伪造。
- Reasoning：按 Runtime 支持值映射。
- 预算：最大运行时间、最大轮次、最大 Token 或最大金额；不支持某项时如实显示不可用。
- 工具范围：Web Search、Web Fetch、OpenCLI、Browser Read、文件读取、MCP 工具。
- 数据范围：项目、域名 allowlist、时间范围和地区。

凭据、用户 CLI 登录态和模型密钥留在 Worker。控制面只保存 Profile 引用、能力证明、脱敏健康状态和审计信息。

## 5. 核心对象模型

### 5.1 RuntimeManifest

```json
{
  "runtimeId": "codex",
  "adapterVersion": "1.0.0",
  "binaryPath": "C:/Program Files/Codex/codex.exe",
  "detectedVersion": "x.y.z",
  "protocol": "jsonl",
  "capabilities": {
    "streaming": true,
    "structuredOutput": true,
    "resume": true,
    "webResearch": true,
    "browser": false
  },
  "permissionProfiles": ["observe", "research", "propose"],
  "health": "ready"
}
```

### 5.2 ResearchTaskV1

```json
{
  "schemaVersion": "research.task.v1",
  "taskId": "uuid",
  "projectId": "uuid",
  "mode": "crawl_research",
  "question": "目标研究问题",
  "entities": [{"type": "brand", "name": "Example", "aliases": []}],
  "queries": [{"text": "example pricing", "language": "zh-CN", "market": "CN"}],
  "sourcePolicy": {
    "allowedDomains": ["example.com"],
    "allowedTools": ["web_search", "web_fetch", "opencli"],
    "maxPages": 100,
    "maxDepth": 2
  },
  "outputSchema": "research.result.v1",
  "budget": {"timeoutSeconds": 900, "maxTurns": 30}
}
```

### 5.3 ResearchResultV1

必须包含：

- `summary`：回答研究问题的结论。
- `findings[]`：陈述、类型、重要度、置信状态和证据引用。
- `evidence[]`：真实 URL、标题、发布时间、访问时间、摘录、内容哈希、采集工具。
- `queries[]`：执行过的查询和结果数量。
- `coverage`：成功、失败、跳过和被策略阻断的来源。
- `contradictions[]`：相互冲突的证据和待人工判断项。
- `limitations[]`：登录墙、robots、区域、配额、时间范围和样本限制。
- `usage`：Runtime、模型、轮次、Token、费用和耗时；Runtime 不提供的字段保持空值。

### 5.4 RuntimeEventV1

闭合事件集合：

- `started`
- `text_delta`
- `query`
- `tool_call`
- `tool_result`
- `evidence`
- `state`
- `usage`
- `approval_required`
- `completed`
- `failed`
- `cancelled`

Adapter 必须把原生事件映射到该集合。未知事件可以保存为脱敏原始 Trace，但不能直接进入业务事件流。

## 6. 主要用户流程

### 6.1 配置执行节点

1. 管理员安装一个或多个受支持 CLI，并在本机完成登录或 Provider 配置。
2. Worker 启动时发现二进制和版本，执行只读健康检查。
3. Worker 上报 RuntimeManifest，不上传密钥、Cookie 或完整用户配置。
4. 管理员在“团队与系统 / Agent Runtimes”中查看健康、版本、模型和权限能力。
5. 管理员创建 Runtime Profile，并绑定允许使用的项目、工具和预算。

### 6.2 发起爬虫调研

1. 用户新建“调研项目”，填写问题、对象、竞品、地区、语言和时间范围。
2. 来源接入助手提出来源与查询计划，用户确认范围和预算。
3. 调度器选择具备所需 Runtime、模型和工具能力的 Worker。
4. CLI Agent 执行来源发现、查询、抓取和证据整理。
5. 标准化结果进入 Records、Evidence、Findings 和不可变 Observation Version。
6. 系统运行交叉验证，标记冲突、覆盖不足和过期证据。
7. 用户复核 Finding 并发布报告或转入 GEO 项目。

### 6.3 发起 GEO 布局

1. 用户创建 GEO 项目并确认品牌实体、竞品和官网。
2. 系统从站内搜索、客服问题、社媒讨论和竞品内容生成查询主题簇。
3. 用户冻结 Query Set 版本和观测条件。
4. 系统执行官网观测与生成式搜索观测，保存答案、引用和 Trace。
5. 系统生成可见性面板、竞品差距、引用来源地图和主题覆盖矩阵。
6. Agent 生成内容布局方案与 Brief，研究负责人复核后创建任务或交付。
7. 发布窗口结束后按同一 Query Set 复测，并显示变化和波动。

## 7. 信息架构

| 一级入口 | 主要内容 |
|---|---|
| 今天 | 运行状态、待复核 Finding、GEO 波动、失败任务、预算预警 |
| 调研项目 | 研究问题、来源计划、Records、Findings、证据、运行和报告 |
| GEO 布局 | 品牌、Query Set、观测、竞品差距、主题地图、内容任务、复测 |
| 来源 | Provider、OpenCLI、通用 Web、授权浏览器、来源健康与覆盖 |
| 自动化 | 研究流程、Skill、计划任务、交付和 Runtime Profile |
| 团队与系统 | Worker、Agent Runtimes、模型连接、Browser Profile、权限与审计 |

CLI 名称只在 Runtime Profile、运行详情和管理员界面出现。普通用户在创建任务时看到的是“速度优先、证据优先、成本优先、自定义执行器”等业务策略，并可展开查看实际 Runtime。

## 8. 调度与路由

调度器根据以下条件选择 Worker 与 Runtime：

1. 任务要求的工具、市场、浏览器 Profile 和 Runtime 能力。
2. Runtime 健康、版本兼容、当前并发和最近失败率。
3. 项目权限、域名 allowlist 和数据驻留要求。
4. 用户指定的模型 Provider、预算和推理档位。
5. 研究模式：单 Agent、并行调研、交叉核验或评审者模式。

自动路由必须把最终选择和原因写入运行记录。指定 Runtime 不可用时，默认等待或失败，不静默切换到另一个模型产生不可比结果；只有用户开启“允许兼容替代”才可切换。

## 9. 安全、合规与治理

### 9.1 权限 Profile

| Profile | 能力 |
|---|---|
| Observe | 读取项目任务、公开网页和已授权来源；不能修改文件或外部状态 |
| Research | 在隔离运行目录内生成中间产物，调用白名单搜索、抓取和浏览器只读工具 |
| Propose | 可以创建 ThreadBeacon 内部 Finding、Brief 和任务草稿；不能直接向外部发布 |

### 9.2 强制规则

- 进程必须使用参数数组启动，不通过 Shell 拼接命令。
- 二进制路径、版本范围和固定参数由管理员签名或部署配置确定。
- 每次运行使用独立工作目录、独立输出目录和清洗后的环境变量。
- CLI 子进程继承的凭据按 Runtime 精确注入，不能获得控制面数据库凭据、节点注册密钥或其他 Provider 密钥。
- 限制运行时间、输出字节、页面数、抓取深度、并发和重定向。
- 超时、取消或 Worker 退出时终止整个进程树。
- 网页内容按不可信输入处理，不能把页面指令提升为系统指令。
- 遵守 SSRF、DNS 重绑定、robots、域名 allowlist、登录墙和访问挑战策略。
- 禁止验证码绕过、平台签名逆向、DRM 绕过、虚假账号、凭据导出和隐藏式数据外传。
- CLI 产生的结论没有真实 Evidence 引用时只能作为“待核验假设”。
- 自动外部写入保持关闭；需要写入时走动作提案、风险判定、人工确认、执行和审计链路。

## 10. 非功能要求

### 10.1 可靠性

- 控制面任务、Runtime Run 和 Worker 租约持久化。
- 重试使用新的 attempt 与 fencing token，过期 Worker 的回传不得覆盖新结果。
- CLI 版本升级后先撤下能力，兼容性检查通过后再上报 ready。
- 运行可取消、可恢复、可追踪；不支持恢复的 Runtime 必须从已保存检查点创建新 attempt。

### 10.2 可观测性

每次运行记录：

- Runtime、Adapter、CLI、模型和 Tool 版本。
- Worker、Profile、任务、工作流、项目和 Query Set 版本。
- 原生事件 Trace 的脱敏副本。
- 标准事件、工具调用、证据、费用、耗时、退出码和错误分类。
- 进程启动参数的脱敏视图；不记录 API Key、Cookie、Authorization 和用户输入密码。

### 10.3 性能与容量

- Worker 按 Runtime 和浏览器资源分别配置并发。
- 控制面支持同一项目并行查询与跨 Agent 核验。
- 单次运行的 stdout、stderr、Trace、Evidence 和页面内容分别限额。
- 大型 Trace、截图、答案快照和报告存入 S3/MinIO，数据库保存索引和摘要。

## 11. 成功指标

### 11.1 产品指标

- 新项目首次调研成功率。
- 有效证据覆盖率与证据点击率。
- Finding 人工确认率、驳回率和平均复核时间。
- Query Set 周期复测率。
- GEO 内容 Brief 被接受并进入执行的比例。
- 内容执行后的 Owned Citation Share 和 Topic Authority Coverage 变化。

### 11.2 运行指标

- Runtime 发现成功率和健康率。
- 各 Adapter 任务成功率、超时率、取消成功率和结构化输出合格率。
- 无证据 Finding 比例。
- 被策略阻断的工具调用数量与原因。
- 单次调研平均费用、Token、耗时和证据条数。

## 12. 验收标准

1. Worker 能同时发现并上报 Pi、Codex、Claude Code、OpenCode Runtime，未安装或版本不兼容时不声明 ready。
2. 管理员可以查看每个 Runtime 的版本、协议、模型 Provider、权限能力、健康和最近错误。
3. 用户可以创建 Runtime Profile，并绑定项目、权限、预算、工具、模型和路由策略。
4. 四类 Runtime 都能执行同一个 `ResearchTaskV1`，产生统一标准事件和 `ResearchResultV1`。
5. DeepSeek 能作为 Provider Profile 被至少 Pi、Codex、Claude Code、OpenCode 中两个 Runtime 选择，且不新增虚假的 DeepSeek CLI 类型。
6. 研究结果中的 Finding 能回到真实 Evidence；无 URL 或不可复核内容被标记为假设。
7. 运行支持超时、取消、进程树回收、输出限额、租约恢复和过期回传拒绝。
8. CLI 登录态和模型凭据不进入控制面数据库、API 响应、审计日志或前端状态。
9. GEO 项目可维护品牌、竞品、Query Set 版本、观测条件和周期计划。
10. GEO 运行展示样本量、Surface、模型、地区、语言、时间和波动，不输出脱离上下文的单一权威分数。
11. 系统能根据证据生成主题地图、内容缺口、引用来源地图、页面机会和内容 Brief。
12. 默认不能自动发布外部内容；风险写动作必须经过人工确认和完整审计。
13. TypeScript、Java 控制面、前端和端到端测试全部通过，文档、环境变量示例、部署说明和故障排查同步更新。

## 13. 明确不做

- 不把任意本地命令执行包装成来源能力。
- 不允许普通用户上传二进制或自由拼接命令行参数。
- 不用登录态模拟消费者界面来伪造可重复 GEO 指标。
- 不将 Agent 的自由文本当作已验证证据。
- 不承诺通过特定技术操纵生成式搜索排名。
- 不绕过平台访问控制、验证码、robots 或其他技术措施。
- 不因 OpenCLI 或 CLI 目录出现某个平台名就宣称具备商业授权。

## 14. 参考协议

- Codex 非交互模式：<https://developers.openai.com/codex/noninteractive>
- Claude Code CLI：<https://code.claude.com/docs/en/cli-usage>
- Pi RPC：<https://pi.dev/docs/latest/rpc>
- OpenCode CLI：<https://opencode.ai/docs/cli>
- DeepSeek Agent Integrations：<https://api-docs.deepseek.com/guides/coding_agents/>

