# ThreadBeacon → Razormind 形态整体重构计划

> 状态：实施主计划
>
> 适用范围：Web 产品形态、领域模型、Java 控制面 API、PostgreSQL 数据模型、TypeScript Worker 契约
>
> 不适用范围：更换现有技术栈、复制 opencli-Razormind 代码、无验证地扩展平台或通用 Agent 能力

## 0. 执行结论

ThreadBeacon 不重写为 opencli-Razormind，也不继续在现有 `/studio#tab` 单页上叠加功能。目标是保留 ThreadBeacon 已验证的 Java、PostgreSQL、MinIO、TypeScript Worker 和安全边界，重构为类似 Razormind 的项目化、版本化、可观察、可治理的产品形态。

最终唯一主链路：

```text
Workspace
  → Project
    → Workflow Draft
      → Validate
        → Immutable Workflow Version
          → Run
            → Observation / Record
              → Finding + Evidence Link + Review
                → Immutable Report Version
                  → Delivery Operation / Attempt / Outcome
```

重构不是换皮。完成后必须同时满足：

1. 用户从项目进入所有研究工作，不再从 Job、Worker、DAG 等实现对象开始。
2. 草稿、校验、发布、运行、证据、报告和交付有稳定且不可混淆的生命周期。
3. 所有异常、待审核和不确定交付进入同一个待处理中心。
4. 页面、API、数据库和 Worker 对同一对象使用同一身份与状态语义。
5. 旧接口只在一个有截止日期的兼容层中存在，不允许新代码继续依赖。
6. 每阶段先通过验收门槛，再进入下一阶段；不以“页面看起来完成”作为完成标准。

预计实施周期为 **8–10 周**。如果只有一名主要开发者，按 10–12 周安排；多人并行时也不能跨越领域契约和数据迁移门槛抢做 UI。

## 1. 为什么必须整体重构

当前代码已经拥有相当完整的底层能力，但产品结构仍有四个根本问题：

### 1.1 页面按技术能力聚合，而不是按用户任务组织

`PlatformClient` 同时加载项目、工作流、运行、证据、交付、资源、插件、浏览器等数据，并通过 hash 切 tab。继续增加功能会导致：

- 一个页面知道所有 API 和所有领域类型；
- 一个接口或类型变化引发多个无关页面修改；
- URL 不能稳定表达项目上下文和选中对象；
- 权限、加载、错误和空状态只能不断加条件分支。

### 1.2 领域对象已经出现，但边界仍混在聚合 Service 中

`JobService`、`PlatformService`、`SkillService` 同时承担命令校验、数据库读写、状态迁移、投影查询和产品指标。随着 Observation、Finding、Report 和 Delivery 增长，继续加方法会形成永久补丁层。

### 1.3 新旧主路径同时存在

当前既有快速 Job，也有 Project/Workflow Run；既有原始 Report JSON，也有审核后的可读报告；既有 Studio 聚合接口，也有单独资源接口。若不设退役规则，两套语义会长期互相兼容。

### 1.4 能力存在与项目可运行尚未完全分离

安装了 OpenCLI、存在 Worker 或创建了 Profile，不代表某个项目当前可运行。必须建立由实际依赖和探测结果派生的 Capability Readiness 与 Project Readiness。

## 2. 目标产品形态

## 2.1 全局信息架构

全局只保留一个侧边栏：

| 一级入口 | 用户问题 | 主要对象 |
|---|---|---|
| 今天 | 现在有什么需要我处理？ | Attention Item、System Pulse、Recent Report |
| 项目 | 我们持续研究什么？ | Project |
| 报告 | 团队产出了什么？ | Report Version |
| 自动化 | 哪些研究方法在重复运行？ | Automation、Playbook、Skill |
| 设置中心 | 系统缺什么、哪里不健康？ | Capability Readiness、Connection、Execution Resource |
| 团队与系统 | 谁能做什么，系统如何治理？ | Workspace、Member、Role、Audit、Developer Access |

普通研究员默认看到“今天、项目、报告”。自动化、设置中心和团队系统根据角色展示，但使用同一应用壳，不建立第二套后台。

## 2.2 项目内信息架构

进入项目后使用横向项目导航，不增加第二个永久侧边栏：

| 项目页 | 职责 | 不应出现 |
|---|---|---|
| 概览 | 研究目标、负责人、就绪度、最新变化、阻塞项、下一动作 | 完整日志、raw JSON |
| 编排 | Primary Workflow、草稿、校验、版本发布、高级画布 | Worker 管理、运行日志墙 |
| 运行 | Automation、Run、节点事件、Trace、重试与恢复 | 编辑工作流定义 |
| 数据与证据 | Observation、Record、Finding、Evidence Link、Review | 来源凭据明文 |
| 报告与交付 | 报告版本、交付对象、Delivery 状态 | 把 HTTP 200 当成业务成功 |
| 项目设置 | 来源、成员权限、连接授权、频率、保留策略 | 全局 Worker 和系统密钥 |

## 2.3 稳定路由

目标路由一次确定，不继续用 hash 扩展：

```text
/today
/projects
/projects/new
/projects/:projectId
/projects/:projectId/orchestration
/projects/:projectId/operations
/projects/:projectId/data
/projects/:projectId/delivery
/projects/:projectId/settings
/reports
/reports/:reportId
/automation
/setup
/settings/workspace
/settings/members
/settings/connections
/settings/execution
/settings/developer
/settings/audit
```

兼容期内：

- `/` 重定向到 `/today`；
- `/studio#projects` 重定向到 `/projects`；
- `/studio#workflows` 根据已选项目重定向到项目编排页；
- 其余 `/studio#*` 显示一次迁移提示并重定向到确定的新路由；
- 新功能禁止添加新的 hash tab。

## 3. 目标领域模型与不可违反的约束

## 3.1 Workspace

Workspace 是成员、角色、Connection、Execution Resource、能力策略和审计的治理边界。

约束：

- 所有用户操作都解析出明确 Workspace；
- 所有跨项目资源必须属于同一 Workspace；
- Workspace 切换只改变上下文，不复制业务数据；
- `owner_id` 兼容字段逐步映射为 `workspace_id`，领域代码不继续把 owner 当 Workspace。

## 3.2 Project

Project 是持续研究一个决策问题的唯一主容器，拥有目标、负责人、跟踪对象、Primary Workflow、运行、发现、报告和交付配置。

约束：

- Web 创建的 Run、Finding、Report、Delivery 必须有 `project_id`；
- 快速 Job 不再作为 Web 主路径；需要保留时归入系统生成的 Scratch Project；
- 删除 Project 采用归档优先，物理删除必须经过审计和保留策略；
- Project Readiness 为派生状态，不能由前端手工设置。

## 3.3 Source 与 Connection

本轮不照搬 Razormind 最重的 Workspace Source Revision 体系，采用足够稳定的两层模型：

- Connection：Workspace 拥有的授权或连接能力，仅保存引用和策略；secret 继续留在 Worker 或加密存储边界。
- Project Source：Project 对某个站点、API、RSS 或公开网页的研究范围和采集配置。

约束：

- Project Source 引用 Connection，不复制 secret；
- Project Source 保存最近成功、连续失败、cursor 和健康投影；
- Workflow Version 固化执行所需的 Source 配置快照或 revision；
- 来源健康变化不修改历史 Run 和 Observation。

## 3.4 Workflow 生命周期

状态模型固定为：

```text
draft → validating → valid / blocked → published
```

约束：

- Draft 可修改且使用 revision 乐观锁；
- Validate 产出结构化问题列表和 Readiness，不只返回字符串；
- Publish 只接受通过校验的 revision；
- Workflow Version 不可修改；
- Automation 与 Run 只绑定确切 Version；
- 修改 Draft 不影响已发布 Version 和正在运行的 Run；
- 没有 runtime binding 的节点必须是 blocked/preview/design，不能伪装成 real。

## 3.5 Run 与内部 Job

Run 是用户理解的一次完整研究执行，Job/Task 是 Run 内部的可调度执行单元。

Run 状态：

```text
queued → running → waiting_review / blocked → succeeded / failed / cancelled
```

约束：

- Run 绑定 Project、Workflow Version、触发者和触发方式；
- 重试节点继续属于同一 Run，并形成新的 attempt；
- 用户明确“重新运行整个流程”才创建新 Run；
- Job 不出现在一级导航；
- 所有 Job 事件投影为 Run Trace，但不覆盖原始事件；
- cursor 仅在结果持久化成功后推进。

## 3.6 Observation、Record、Finding、Evidence Link、Review

这些对象构成可信研究资产：

- Observation：一次不可变来源观测，保存内容哈希、捕获时间、来源 URL、原始 payload 引用和变化类型。
- Record：用于检索和分析的标准化数据，可跨 Observation 去重，但不能替代 Observation 历史。
- Finding：系统或研究员提出的研究发现。
- Evidence Link：Finding 对 Observation/Record 具体片段的支持、反驳或背景引用。
- Review：对 Finding 的批准、编辑、驳回和理由记录。

约束：

- Observation 只新增，不覆盖；
- Finding 编辑形成 Review revision，不静默改写历史；
- Finding 未批准时不能进入正式报告；
- Evidence Link 必须指向稳定 ID，不能只保存 URL 文本；
- 删除原始内容时保留合规 tombstone、哈希和审计关系。

## 3.7 Report

Report 是面向受众的不可变版本化交付物，不是动态查询结果。

约束：

- Report Version 绑定 Project、Run、Workflow Version、方法版本、Finding revision 和 Evidence Link；
- 草稿报告可以重建，正式发布版本不可修改；
- 报告默认只包含已批准 Finding；
- 报告缺失证据投影时显示不完整状态，不能显示“可信/已验证”；
- JSON 是导出格式，不是主要阅读界面。

## 3.8 Delivery

Delivery 分成业务意图、技术尝试和业务结果：

```text
Delivery Operation
  → Delivery Attempt(s)
    → Execution Result
      → Business Outcome
```

约束：

- 同一业务意图有稳定 Operation ID；
- 重试产生新 Attempt，但不产生新业务意图；
- HTTP 2xx 只代表技术提交，不自动代表已送达；
- unknown 结果禁止盲目无限重试；
- failed/unknown 进入待处理中心；
- 外部副作用必须可审计、可解释、可限制。

## 3.9 Attention Item

Attention Item 是对真实领域状态的待处理投影，不复制或替代原状态。

来源包括：

- blocked/failed Run；
- 待复核 Finding 或 Report；
- Skill 高风险动作确认；
- Connection/Profile 失效；
- Delivery failed/unknown；
- 长时间 queued 或 Execution Resource 离线；
- Dify 导入阻断节点。

约束：

- 每条 Attention Item 指回权威对象；
- resolved/ignored 是人的处理状态，不改变 Run/Delivery 历史；
- 相同根因使用稳定 dedup key，避免重复刷屏。

## 3.10 Readiness

Readiness 必须派生，不建立人工维护的“已就绪”布尔值。

统一状态：

```text
ready
missing_resource
blocked_by_policy
needs_approval
degraded
unknown
```

Workspace Readiness 检查共享能力；Project Readiness 只检查当前项目实际依赖。每个非 ready 状态必须返回：

- `code`：稳定机器码；
- `message`：用户语言；
- `affectedObject`；
- `remediationRoute`；
- `lastCheckedAt`；
- `evidence`：探测或策略依据。

## 4. Java 控制面目标模块

保持一个 Spring Boot 应用，不引入 Spring Cloud。按领域包拆分：

```text
com.threadbeacon.control
  workspace/       Workspace、成员、角色、审计上下文
  project/         Project、项目概览、项目设置
  source/          Project Source、Connection 引用、来源健康
  workflow/        Draft、Validation、Version、Automation
  run/             Run、Attempt、Trace、恢复
  research/        Observation、Record、Finding、Evidence、Review
  report/          Report Draft、Report Version、渲染投影
  delivery/        Operation、Attempt、Outcome
  capability/      Catalog、Readiness、Execution Resource
  attention/       Inbox 投影与处理状态
  automation/      Skill、计划、触发器
  integration/     MCP、Webhook、Dify、外部兼容边界
  access/          认证、PAT、OIDC、scope
```

模块规则：

1. Controller 只做协议解析、权限入口和响应映射。
2. Application Service 组织用例与事务，不拼装任意页面大对象。
3. Domain Policy 保存状态机和不变量，不依赖 HTTP。
4. Repository 封装 SQL；业务 Service 不再散落长 SQL 字符串。
5. Projection Query 专门服务列表、概览和报告读取，不承担写操作。
6. 跨模块调用使用明确的应用接口或领域事件，不直接更新别的模块表。
7. Worker 协议继续隔离在 machine ingress Controller 中。

本轮不追求 DDD 框架或事件总线。模块边界通过 package、事务、接口和测试实现，避免为了“架构正确”引入新的基础设施。

## 5. API v2 计划

## 5.1 原则

- 新 UI 只调用 `/api/v2`；
- `/api/v2` 按资源与用例组织，不提供包含全系统数据的 Studio 聚合响应；
- 写操作带 revision、idempotency key 或显式 action contract；
- 列表统一 cursor/limit/filter；
- 错误统一为稳定 `code + message + details + correlationId`；
- Web、MCP 和 Agent 调用同一 Application Service，不复制业务逻辑。

## 5.2 核心端点

```text
GET    /api/v2/me/context
GET    /api/v2/attention
PATCH  /api/v2/attention/:id

GET    /api/v2/projects
POST   /api/v2/projects
GET    /api/v2/projects/:id
PATCH  /api/v2/projects/:id
GET    /api/v2/projects/:id/readiness
GET    /api/v2/projects/:id/overview

GET    /api/v2/projects/:id/sources
POST   /api/v2/projects/:id/sources
POST   /api/v2/projects/:id/sources/:sourceId/probe

GET    /api/v2/projects/:id/workflows
POST   /api/v2/projects/:id/workflows
GET    /api/v2/workflows/:id/draft
PUT    /api/v2/workflows/:id/draft
POST   /api/v2/workflows/:id/validate
POST   /api/v2/workflows/:id/publish
GET    /api/v2/workflows/:id/versions

POST   /api/v2/workflow-versions/:id/runs
GET    /api/v2/projects/:id/runs
GET    /api/v2/runs/:id
GET    /api/v2/runs/:id/events
POST   /api/v2/runs/:id/actions/:action

GET    /api/v2/projects/:id/observations
GET    /api/v2/projects/:id/findings
POST   /api/v2/findings/:id/reviews

GET    /api/v2/projects/:id/reports
POST   /api/v2/projects/:id/report-drafts
POST   /api/v2/report-drafts/:id/publish
GET    /api/v2/reports/:id

POST   /api/v2/reports/:id/deliveries
GET    /api/v2/projects/:id/deliveries
GET    /api/v2/deliveries/:id

GET    /api/v2/capabilities/readiness
GET    /api/v2/execution-resources
GET    /api/v2/connections
```

实际实现允许按阶段增加端点，但禁止再新增 `/api/studio` action 分支或把多个领域写操作塞入同一个 `action` 参数。

## 5.3 兼容与退役

旧 `/api` 接口进入 compatibility adapter：

- 兼容层只能调用 v2 Application Service，不允许直接写表；
- 兼容层不得承载新字段、新状态或新功能；
- 响应附加 deprecation header 和迁移文档链接；
- v2 新 UI 全量切换后的下一个 minor release 删除 `/api/studio` 人工操作入口；
- Worker、MCP 和外部集成接口按独立版本策略保留，不因 UI 重构强行破坏。

## 6. PostgreSQL 迁移计划

数据库迁移采用 expand → backfill → verify → switch → contract，禁止同一语义长期双写。

### 6.1 Expand

- 增加 `workspace_id`、必需的 project/version/revision 引用和新表；
- 新列先允许空值或带明确默认；
- 添加索引与外键，但不立即删除旧列；
- Flyway migration 保持只前进、可在备份上重复验证。

### 6.2 Backfill

- 使用一次性、可重入迁移任务回填历史关系；
- 每批记录保存进度和校验计数；
- 无法归属的 Web 数据进入明确的 Legacy/Scratch Project，不猜测项目；
- 输出迁移报告：总数、成功、隔离、失败、耗时和哈希校验。

### 6.3 Verify

切换前必须满足：

- 新旧对象计数对齐；
- 抽样 Run 能回溯 Project、Version、Observation、Report；
- Report 的 Evidence Link 可打开；
- 外键孤儿数为 0；
- 备份恢复后重复检查结果一致。

### 6.4 Switch

- v2 写路径只写新模型；
- 旧 API 通过 adapter 调 v2 用例；
- 不建立数据库 trigger 双写；
- 观察一个 release 窗口。

### 6.5 Contract

- 删除未被 compatibility adapter 使用的旧列、旧 action 和旧投影；
- 删除前在 CI 运行 migration governance test；
- 删除动作单独提交并带恢复说明。

## 7. 前端目标结构

保持 React 19 + Vite + 原生 CSS，增加轻量客户端路由和数据层，不迁移 Next.js，不引入大型 UI 框架。

```text
apps/control-plane/app
  shell/               AppShell、GlobalNav、ProjectNav、WorkspaceSwitcher
  routes/              稳定路由定义、权限和面包屑
  api/                 v2 client、错误模型、查询键
  features/
    attention/
    projects/
    orchestration/
    operations/
    research-data/
    reports/
    delivery/
    automation/
    setup/
    settings/
  components/          无领域依赖的通用组件
  styles/              token、layout、feature styles
```

边界规则：

- Route 负责组合 feature，不直接拼 fetch；
- 每个 feature 只消费自己的 API client 和类型；
- 服务端类型通过 OpenAPI 生成或集中映射，不在多个组件重复声明；
- 页面级错误、空状态和 loading 使用统一组件；
- 项目上下文从路由参数解析，不从全局隐式 selectedProject 猜测；
- `platform-client.tsx` 在迁移结束时删除，而不是保留为隐藏兼容页；
- `main.tsx` 只负责启动、认证和路由挂载，目标少于 150 行；
- 单个 feature 页面建议少于 300 行，超出时按用例拆分，不按视觉碎片机械拆文件。

## 8. 分阶段实施计划

任何阶段未通过 Exit Gate，不进入下一阶段，也不在旁边继续扩展平台、Skill、集群或新 Dashboard。

## 阶段 0：冻结与基线（2–3 天）

目标：固定重构边界，建立可以比较的基线。

交付物：

- 本文档评审通过；
- 目标路由、领域词汇和状态机冻结；
- 当前 API/页面/数据库/能力台账快照；
- 一份可恢复数据库备份；
- 当前完整 `pnpm check` 结果；
- 黄金路径 E2E 脚本草案；
- `legacy / migrate / keep` 三分类清单。

Exit Gate：

- 每个现有入口都有目标归宿；
- 每张核心表都有保留、迁移或删除决定；
- 没有“以后再决定”的一级导航或核心对象。

## 阶段 1：领域契约与 v2 基础（第 1–2 周）

目标：先建立稳定内核，不先重画全部页面。

交付物：

- Java 目标 package 骨架和模块依赖测试；
- 统一错误、分页、revision、idempotency contract；
- Workspace/Project/Workflow/Run 的 v2 API；
- Readiness 模型和 blocked reason contract；
- 新表/新列 expand migration；
- v2 OpenAPI 描述和前端类型生成/集中映射。

Exit Gate：

- Project → Workflow Draft → Validate → Publish → Run 可通过 API 完成；
- Run 明确绑定 Project 和 Workflow Version；
- 旧 API adapter 不直接写新表；
- 核心状态机拥有单元与 PostgreSQL 集成测试。

## 阶段 2：应用壳、项目路由与设置中心（第 2–3 周）

目标：建立 Razormind 式可管控外壳，但不把画布当首页。

交付物：

- AppShell、全局导航、Workspace 切换；
- `/today`、`/projects`、项目概览和项目导航；
- Setup Center 与 Workspace/Project Readiness；
- Attention Item 基础投影；
- 旧 hash 路由重定向；
- 项目创建黄金路径。

Exit Gate：

- 用户复制 URL 能打开同一项目同一页面；
- 普通研究员主路径不出现 Worker、Profile、DAG、MCP 技术名；
- 缺少资源时显示具体修复入口；
- `PlatformClient` 不再负责项目列表、概览和设置中心。

## 阶段 3：编排与运行控制面（第 3–5 周）

目标：完成 Draft/Validate/Publish/Run 和可诊断执行。

交付物：

- 项目编排页与 Primary Workflow；
- 默认线性研究流程和高级 DAG 双层视图；
- 结构化校验结果；
- 版本列表与不可变版本详情；
- Run 列表、详情、节点事件、Trace；
- 取消、重试、恢复和 Attention Item 联动；
- Job 降为高级运行详情。

Exit Gate：

- 修改 Draft 不改变历史 Version/Run；
- blocked 节点不能发布；
- Run 失败可在 5 分钟内从 UI 定位根因和修复入口；
- Worker 断线、来源认证失败和 schema drift 有不同错误码。

## 阶段 4：研究资产、复核、报告和交付（第 5–7 周）

目标：完成真正的业务闭环，而不是只完成运行平台。

交付物：

- Observation/Record 双层数据页；
- Finding、Evidence Link、Review revision；
- 报告草稿和不可变 Report Version；
- 报告阅读、导出和精确引用；
- Delivery Operation/Attempt/Outcome；
- 报告待复核、交付失败/未知进入 Attention Center；
- 历史数据 backfill 与迁移报告。

Exit Gate：

- 报告中 100% 正式 Finding 已批准；
- 抽样 Evidence Link 可回到不可变 Observation；
- 同一 Delivery 重试不产生重复业务意图；
- 旧报告可迁移或明确标为 legacy，不伪装成完整证据报告。

## 阶段 5：自动化、资源和兼容收口（第 7–8 周）

目标：把高级能力放到正确位置，停止新旧模型双轨。

交付物：

- Automation 绑定确切 Workflow Version；
- Skill、Dify、Webhook、MCP 通过统一控制边界；
- Connection、Execution Resource、来源账号授权管理；
- capability exposure matrix 与实际 UI/API 自动校验；
- 新 UI 不再调用 `/api/studio`；
- `platform-client.tsx` 和废弃 hash tab 删除；
- compatibility adapter 加 deprecation 和删除版本。

Exit Gate：

- 新 UI 对旧聚合接口调用数为 0；
- machine ingress/internal endpoint 没有人工主导航入口；
- MCP/Web/Agent 对高风险动作执行同样的权限、revision 和审计检查；
- 所有废弃入口都有确定删除版本。

## 阶段 6：真实验收与发布（第 9–10 周）

目标：证明系统能持续工作，不以代码完成宣布成功。

交付物：

- Docker Compose 完整安装与恢复演练；
- PostgreSQL/MinIO 备份恢复验收；
- 真实模型和至少三类真实来源的端到端运行；
- 3 个设计伙伴两周试点；
- 多架构镜像和版本化 release；
- 操作手册、迁移说明、已知限制和回滚说明。

Exit Gate：

- 满足第 10 节产品效果门槛；
- 所有 P0 数据完整性与安全测试通过；
- 没有 blocker 级迁移问题；
- release 安装不依赖开发者本机状态。

## 9. 防止“一直打补丁”的硬规则

以下规则不是建议，是本次重构的合并门槛。

### 9.1 一份主计划

- 本文档决定目标架构和实施顺序；
- `ROADMAP.md` 决定产品验证是否通过；
- 其他 PRD 提供需求细节，但不得创建另一套目标对象或导航；
- 目标变化必须先修改本文档并记录决策原因，再改代码。

### 9.2 一个对象一个权威来源

- Run 状态以 Run/Attempt 表和状态机为准；
- Attention 只是投影；
- Report Version 是交付物权威版本；
- Readiness 由依赖与探测派生；
- 禁止同一个状态分别保存在前端、本地 JSON 和多个数据库字段。

### 9.3 不在兼容层开发新功能

- compatibility adapter 只能翻译请求和响应；
- 不为旧页面增加新字段；
- 不在旧表和新表永久双写；
- 每个兼容入口必须写删除版本。

### 9.4 不做横向功能扩张

重构期间冻结：

- 新平台名称；
- 新通用 DAG 节点；
- 新 Skill 蒸馏机制；
- 新集群拓扑；
- 新 UI 框架；
- 无设计伙伴需求支持的新报表类型。

只允许修复安全、数据丢失、发布阻塞和当前黄金路径缺陷。

### 9.5 纵向切片必须完整

每个功能切片必须同时交付：

```text
数据库迁移
  + 领域状态机/不变量
  + API contract
  + 权限/审计
  + 前端页面
  + 单元/集成/E2E 测试
  + 文档与能力台账
```

缺少任一项不能标记完成，也不能靠下一阶段补齐。

### 9.6 文件和模块规模门槛

- 禁止新增新的全能 `*Service` 或 `*Client`；
- 单个 Controller 不跨两个领域写操作；
- 单个前端页面不直接加载三个以上领域集合；
- 超过边界先拆用例，不通过增加 helper 和 boolean 参数延寿；
- 重复兼容判断出现第二次时，必须提升为边界 adapter 或统一 policy。

### 9.7 先删除再完成

每阶段结束必须列出：

- 本阶段新增对象；
- 被替代对象；
- 已删除代码；
- 尚存兼容债及明确删除版本。

如果只新增而不删除，阶段不能宣布完成。

## 10. 预测达到的效果

预测分为工程效果和产品效果。工程效果可由项目控制；产品效果必须经过真实用户验证，不能仅由代码推断。

## 10.1 工程效果

| 指标 | 当前基线 | 目标 | 验证方式 |
|---|---:|---:|---|
| 核心 Studio 聚合页面 | `platform-client.tsx` 约 900 行并承担多领域 | 删除该文件 | 文件与依赖检查 |
| 前端稳定业务路由 | 主要依赖 `/studio#tab` | 全部使用第 2.3 节路由 | E2E 深链接测试 |
| 新 UI 调用 `/api/studio` | 多个用例 | 0 | 网络契约测试 |
| Web Run 的项目归属 | 仍需兼容 projectless | 100% 有 Project | PostgreSQL 约束与查询 |
| Run 版本归属 | 已有基础 | 100% 绑定不可变 Workflow Version | 集成测试 |
| 正式报告 Finding 审核率 | 已有审核能力但未完整验收 | 100% approved revision | 报告发布 policy 测试 |
| Evidence Link 可回溯率 | 待真实验证 | ≥ 95%，工程抽样目标 100% | E2E 与抽样 |
| 旧兼容写路径 | 多处聚合 action | 一个 adapter，随后删除 | 架构测试 |
| 错误可行动性 | 部分纯文本 | 100% P0 错误有稳定 code，阻塞项有修复路由 | contract test |
| 完整质量门 | `pnpm check` | 保持全绿并增加 v2/E2E/migration gate | CI |

预期开发影响：

- 新增一个项目页面不再修改全局 `PlatformClient`；
- Run、Report、Delivery 的状态变化只修改各自模块和共享 contract；
- 前后端联调从“猜聚合 JSON 字段”变为按 OpenAPI contract；
- 数据迁移问题集中在一个 release 窗口，不形成长期双写；
- 后续新增能力先决定归宿和 readiness，再决定是否展示。

## 10.2 操作与管控效果

| 场景 | 目标效果 |
|---|---|
| 找到失败原因 | 从进入项目到定位根因 ≤ 5 分钟 |
| 找到待审核内容 | 从今天页 1 次点击进入对应 Finding/Report |
| 判断项目能否运行 | 项目概览直接显示 readiness、阻塞原因和修复入口 |
| 回溯一条结论 | 最多 2 次点击到 Observation、来源 URL、哈希和 Run |
| 查看历史执行 | 明确看到 Workflow Version、触发方式、节点 attempt 和 Trace |
| 判断交付是否成功 | 区分提交成功、已确认送达、失败、未知 |
| 团队权限管控 | 所有写操作可解释到 Workspace、角色、scope 和审计主体 |
| 外部 Agent/MCP 操作 | 与 Web 使用同一权限、revision、审批和审计边界 |

## 10.3 产品效果

基准门槛沿用现有战略文档：

| 指标 | 目标 |
|---|---:|
| 管理员开始部署到 Workspace Ready | ≤ 30 分钟 |
| 创建项目到首份基线报告 | ≤ 20 分钟，不含外部采集等待 |
| 可打开且对应结论的引用 | ≥ 95% |
| AI Finding 批准或编辑后批准比例 | ≥ 60% |
| 相比原流程节省研究时间 | ≥ 40% |
| 第二周仍主动运行并交付 | ≥ 2/3 设计伙伴 |
| 试点结束愿继续使用或付费支持 | ≥ 2/3 设计伙伴 |

如果完成工程重构但未达到这些产品门槛，结论是“平台更可管控”，不能宣称“产品验证成功”。此时应调整研究方法、ICP 或交付物，不继续用新功能掩盖需求问题。

## 10.4 综合成熟度预测

在不扩张范围且通过全部 Exit Gate 的前提下：

| 维度 | 当前估计 | 完成后合理目标 |
|---|---:|---:|
| 产品结构清晰度 | 6/10 | 8.5/10 |
| 运行可观察与可恢复 | 7.5/10 | 9/10 |
| 团队管控体验 | 6/10 | 8.5/10 |
| 证据与交付可信度 | 6.5/10 | 8.5/10 |
| 工程可维护性 | 7/10 | 8.5/10 |
| 发布成熟度 | 5.5/10 | 8/10 |
| 市场验证 | 3.5/10 | 取决于设计伙伴，不由重构自动提升 |

预期结果不是复制 Razormind 的功能规模，而是在“持续竞品研究”主链路上达到相近的可见性和管控感，同时保持更小的代码体量、更严格的凭据边界和更低的部署复杂度。

## 11. 测试与验收矩阵

| 层 | 必须覆盖 |
|---|---|
| Domain Unit | 状态迁移、不变量、权限、readiness、报告发布、交付重试 |
| Repository Integration | PostgreSQL 外键、并发 revision、idempotency、分页、迁移回填 |
| Worker Contract | claim、heartbeat、attempt、complete/fail、cursor durable write |
| API Contract | v2 schema、错误码、scope、deprecation、MCP/Web 一致性 |
| Frontend Component | 空状态、blocked reason、权限禁用、错误恢复 |
| E2E | 创建项目→来源探测→发布→运行→复核→报告→交付 |
| Migration | 生产形态备份副本上的 expand/backfill/switch/restore |
| Live Acceptance | 真实模型、真实来源、真实 Delivery 通道，不提交 secret |

关键 E2E 场景：

1. 新 Workspace 首次完成竞品研究基线。
2. 第二次运行识别 new/changed/unchanged。
3. Finding 被批准、编辑后批准和驳回。
4. 正式 Report 只包含批准后的 revision。
5. Worker 离线导致 Project blocked，并给出修复入口。
6. Run 中断后从安全 checkpoint 恢复。
7. Delivery timeout 后先查询/确认状态，不盲目重复业务意图。
8. viewer 无法修改，editor 无法执行 owner 管理动作。
9. MCP 与 Web 对相同操作得到相同权限结果并写入 audit。
10. 旧 `/studio` URL 能确定性迁移，但新 UI 不调用旧写接口。

## 12. 风险、降级与停止规则

| 风险 | 早期信号 | 处理 |
|---|---|---|
| 重构变成全面重写 | 两周后黄金路径仍无法运行 | 保持纵向切片，先完成 v2 最小链路 |
| 新旧模型长期双轨 | 新 UI 仍新增旧接口字段 | 阻止合并，功能只能进入 v2 |
| 领域模型过重 | 大量对象没有当前用例 | 删除或延后，不照搬 Razormind 全模型 |
| UI 先行造成假完成 | 页面大量 mock/placeholder | 未接真实 v2 contract 不计完成 |
| 数据迁移不可验证 | 回填只能一次性手工执行 | 改为可重入任务并产出校验报告 |
| 兼容层扩张 | adapter 出现业务判断或 SQL | 将逻辑移入 Application Service |
| 真实来源阻塞 | 关键来源无法稳定合法获取 | 收窄来源承诺，不伪造 readiness |
| 试点不续用 | 第二周主动交付低于 2/3 | 停止平台扩张，重新验证 ICP/报告 |

立即停止当前阶段并修正的条件：

- 出现数据丢失或 Observation 被覆盖；
- 历史 Workflow Version 被修改；
- 高风险动作绕过权限、审批或审计；
- 新 UI 依赖旧聚合接口的新行为；
- 为赶页面进度引入第二套状态定义；
- 完整质量门连续失败且仍继续叠加功能。

## 13. 提交和发布策略

每个阶段使用可独立回滚的提交序列：

1. contract/ADR；
2. expand migration；
3. domain/application service；
4. v2 query/command API；
5. frontend vertical slice；
6. compatibility adapter；
7. backfill/verification；
8. old path deletion。

禁止把整个 8–10 周重构放进一个无法审查的大提交。每个纵向切片必须保持主分支可构建、可测试、可运行。

Release 建议：

- `v0.9.0-alpha.1`：v2 Project/Workflow/Run 与新应用壳；
- `v0.9.0-alpha.2`：Observation/Finding/Report/Delivery；
- `v0.9.0-rc.1`：旧 UI 退役、迁移和完整 Compose 验收；
- `v0.9.0`：设计伙伴门槛和发布验收通过。

## 14. 完成定义

只有同时满足以下条件，才能宣布“已完成 Razormind 形态重构”：

- 稳定信息架构和项目路由全部落地；
- Web 主链路全部使用 `/api/v2`；
- `platform-client.tsx` 和旧 Studio hash 写路径删除；
- Project → Version → Run → Observation → Finding → Report → Delivery 全链可追溯；
- Attention Center 覆盖 P0 人工处理场景；
- Workspace/Project Readiness 基于真实依赖和探测；
- compatibility adapter 没有新业务逻辑并有删除版本；
- 数据迁移、备份、恢复和真实端到端验收通过；
- 3 个设计伙伴完成两周试点并记录指标；
- `pnpm check`、v2 contract、PostgreSQL migration 和 E2E 全绿；
- 文档、OpenAPI、能力归宿台账与实际实现一致。

最终判断标准：

> 用户能够从“今天”发现问题，从“项目”理解目标，从“编排”控制版本，从“运行”定位故障，从“数据与证据”复核事实，从“报告与交付”确认结果；管理员能够从“设置中心”看到真实就绪度，而不需要理解代码目录、数据库表或 Worker 内部协议。
