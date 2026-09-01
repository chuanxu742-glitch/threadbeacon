# ThreadBeacon 研究团队版产品优化 PRD

## 0. 结论先行

ThreadBeacon 面向研究团队时，核心产品不是“采集控制台”，而是：

> 研究团队围绕一个研究问题，协作接入来源、持续运行研究流程、产出可复核证据报告，并把结果交付给业务方。

Worker、DAG、Skill、MCP、Dify、Browser Profile 都应该是**内置能力**，但不应该全部作为普通用户的一层导航暴露。

产品原则：

> 内置能力要产品化，不要把实现名直接丢给研究员。

---

## 1. 背景

当前 ThreadBeacon 已具备较完整的技术底座：

- Java Control Plane：身份、工作区、任务、工作流、审计、交付。
- TypeScript Worker：能力发现、任务执行、Provider 适配、回传报告。
- Web 控制台：Dashboard、Studio、Skills、Browser、Dify、Webhook、MCP 等入口。
- 数据资产：records、reports、evidence、workflow trace、audit logs。

当前主要问题不是能力缺失，而是：

1. 面向团队的产品心智还不够清晰。
2. 普通研究员被 Worker、DAG、Skill、MCP、Dify、Browser Profile 等技术概念干扰。
3. 团队协作闭环不完整：成员、工作区切换、邀请接受、报告交付应进入主路径。
4. 首次从“研究问题”到“团队可读报告”的路径不够短。
5. 报告仍偏 API 产物，不像团队可交付资产。

---

## 2. 产品定位

### 2.1 定位

ThreadBeacon 是面向研究团队的开源自托管研究情报工作台。

一句话：

> 让研究团队把一次调查，沉淀成可重复运行、可追溯证据、可自动交付的研究系统。

### 2.2 目标用户

主要用户不是泛开发者，而是有持续研究需求的团队：

- 市场研究团队
- 竞品研究团队
- 舆情 / 消费者洞察团队
- 内容趋势研究团队
- 投研 / 行业分析团队
- 企业内部战略 / 产品研究团队

### 2.3 核心价值

| 价值 | 描述 |
|---|---|
| 多源研究 | 从社交平台、RSS、REST、公开网页、官方 API、自有授权来源采集数据 |
| 可重复流程 | 把一次研究配置成可定时运行的项目流程 |
| 证据可追溯 | 每个结论都能回到原文、记录、运行版本和 Trace |
| 团队协作 | 研究员、负责人、管理员在同一个工作区内分工 |
| 受控自动化 | Skill、Browser、Dify、MCP 等能力有权限、审计和风险确认 |
| 可交付 | 报告能被阅读、复制、导出、投递，而不只是 JSON 下载 |

---

## 3. 产品目标

### 3.1 北极星目标

> 团队能稳定从一个研究问题产出第一份可信研究报告。

### 3.2 核心指标

| 指标 | 定义 |
|---|---|
| 首个团队项目创建率 | 新工作区创建后是否创建第一个研究项目 |
| 首个来源试运行成功率 | 项目中第一个来源是否成功拿到数据 |
| 首份报告生成率 | 首次研究流程是否跑到报告产物 |
| 首份报告打开率 | 报告生成后是否被团队成员打开 |
| 证据点击率 | 报告中原始证据是否被查看 |
| 二次运行率 | 团队是否再次运行同一研究流程 |
| 定时计划创建率 | 是否把一次研究沉淀为持续监控 |
| 协作激活率 | 是否邀请成员、切换工作区、共同查看报告 |
| 待确认处理时长 | 风险动作 / Skill 确认从产生到处理的时间 |

---

## 4. 用户角色

### 4.1 研究员 Analyst

目标：完成研究任务，查看数据和证据报告。

需要看到：

- 项目
- 来源
- 运行状态
- 数据记录
- 证据
- 报告
- 评论 / 复核状态（后续可加）

不应该默认看到：

- Worker 注册细节
- MCP token
- Dify DSL 细节
- Browser CDP/noVNC
- Skill 九要素原始表单

### 4.2 研究负责人 Lead

目标：管理研究项目、模板、成员分工、报告交付。

需要看到：

- 团队项目
- 成员与权限
- 研究模板
- 工作流发布版本
- 定时计划
- 报告发布 / 交付
- 风险确认
- 审计摘要

### 4.3 系统管理员 Admin

目标：保证自托管系统能运行、安全、可审计。

需要看到：

- Worker / 执行节点
- 平台能力
- Browser Profile
- 凭据边界
- OIDC / 本地登录配置状态
- PAT / MCP
- Webhook / Delivery
- 审计日志

### 4.4 自动化工程师 Automation Owner

目标：把复杂研究方法沉淀成可复用自动化。

需要看到：

- DAG 高级画布
- Skill 版本与九要素
- Dify 导入
- MCP tools
- Browser Profile 绑定
- Gate / Agent / Deliver 节点配置

---

## 5. 核心产品原则

### 5.1 内置不等于暴露

Worker、DAG、Skill、MCP、Dify、Browser Profile 都应该内置，但要按用户角色和任务阶段暴露。

普通研究员看到的是产品语义：

| 技术能力 | 产品化名称 | 默认是否暴露给研究员 |
|---|---|---|
| Worker | 执行节点 / 系统运行状态 | 只暴露状态，不暴露注册细节 |
| DAG | 研究流程 / 流程模板 | 暴露简化流程，不默认暴露 DAG 画布 |
| Skill | 自动化助手 / 团队能力 | 暴露可用能力，不默认暴露九要素编辑 |
| MCP | 开发者接口 / 外部工具连接 | 不暴露，放管理员设置 |
| Dify | 导入 Dify 流程 | 不暴露，放高级导入 |
| Browser Profile | 账号授权 / 浏览器身份 | 只在来源授权时暴露，细节给管理员 |

### 5.2 先业务流程，后技术配置

用户第一眼应该理解：

> 我要研究什么？数据从哪来？流程怎么跑？报告在哪里？谁需要看？

而不是先理解：

> Worker 怎么注册？DAG 怎么连？MCP scope 怎么配？Browser Profile 是 anonymous 还是 authenticated？

### 5.3 高级能力必须可发现，但不打扰

不能完全隐藏高级能力，因为团队产品需要管理员和自动化负责人。  
但入口应该放在：

- 项目高级设置
- 团队管理
- 自动化中心
- 开发者接口
- 系统设置

不要和研究员主流程并列。

---

## 6. 信息架构优化

### 6.1 推荐一级导航

一级导航建议调整为：

1. 今天
2. 项目
3. 报告
4. 自动化
5. 团队与系统

如果要更克制，也可保留 3 个一级入口：

1. 今天
2. 项目
3. 自动化

但团队版必须有清晰的团队 / 系统设置入口，不能藏到页面深处。

### 6.2 导航职责

#### 今天

定位：团队当前状态总览。

展示：

- 系统是否可运行
- 今日运行
- 待处理事项
- 最近报告
- 失败任务
- 待确认动作
- Worker / 来源异常摘要

#### 项目

定位：研究工作的主容器。

展示：

- 项目列表
- 项目目标
- 数据来源
- 研究流程
- 运行记录
- 证据资产
- 定时计划
- 交付配置

#### 报告

定位：团队可阅读、复核、交付的成果中心。

展示：

- 报告列表
- 报告详情
- 摘要
- 证据
- 原文链接
- 导出
- 分享 / 交付

#### 自动化

定位：复用团队研究方法。

展示：

- 自动化助手
- Skill 模板
- 已发布 Skill
- 待确认动作
- 纠错 / 回滚
- 高级 DAG 节点
- Dify 导入

#### 团队与系统

定位：管理员管理部署、成员、集成和运行时。

展示：

- 成员与权限
- 工作区
- Worker 执行节点
- Browser Profile
- PAT / MCP
- Webhook
- OIDC 状态
- 审计日志

---

## 7. 是否暴露 Worker / DAG / Skill / MCP / Dify / Browser Profile

### 7.1 总体决策

结论：

> 暴露，但不要在普通研究主路径暴露；要角色化、场景化、产品化暴露。

### 7.2 Worker

#### 是否内置

是。Worker 是系统执行层，必须内置。

#### 是否暴露

- 对研究员：不暴露 Worker 细节，只显示“系统可运行 / 执行资源异常”。
- 对 Lead：显示是否有可用执行资源、哪些项目受影响。
- 对 Admin：完整暴露执行节点、能力、版本、并发、心跳、最后错误、注册命令。

#### 产品化表达

不要默认叫 Worker。  
推荐叫：

> 执行节点

#### 需要的界面

- 系统状态卡片：执行节点在线 / 离线 / 忙碌
- 无执行节点阻塞态：复制注册命令
- 节点详情：能力、并发、版本、最后心跳、错误

#### 不应该做

- 不要让研究员先理解 Worker 才能创建研究。
- 不要在首页第一层展示 token、registration key、runtime_json。

---

### 7.3 DAG

#### 是否内置

是。研究流程需要 DAG 才能支持分支、汇聚、Gate、Agent、Deliver。

#### 是否暴露

- 对研究员：默认暴露为“研究流程模板”，不暴露自由 DAG。
- 对 Lead：可调整流程模板、发布版本。
- 对 Automation Owner：暴露高级 DAG 画布。

#### 产品化表达

不要默认叫 DAG。  
推荐叫：

> 研究流程

高级入口可以叫：

> 高级流程画布

#### 简化默认流程

普通用户默认看到：

```text
来源 → 清洗 → 聚类 → AI 总结 → 证据报告
```

高级用户才看到节点：

- Source
- Normalize
- Dedupe
- Filter
- Gate
- Cluster
- LLM
- Agent
- Report
- Dataset
- Deliver

#### 不应该做

- 不要让新用户手动拖 DAG 才能跑第一次研究。
- 不要把每个节点配置都放到首屏。

---

### 7.4 Skill

#### 是否内置

是。Skill 是团队方法论沉淀的关键。

#### 是否暴露

- 对研究员：暴露“可用自动化助手”，允许选择使用。
- 对 Lead：暴露 Skill 的版本、适用范围、运行证据、风险确认。
- 对 Automation Owner：暴露 SKILL.md、九要素、纠错、回滚。

#### 产品化表达

可以保留 Skill 这个词，但要加业务解释：

> 自动化 Skill：团队沉淀的可复用研究方法。

#### 默认体验

不要让用户从空白九要素表单开始。  
应该先提供模板：

- 官网观测
- 竞品动态追踪
- 舆情主题归纳
- 报告整理
- 高风险动作人工确认

#### 不应该做

- 不要把九要素作为普通研究员入口。
- 不要隐藏人工确认和风险原因。

---

### 7.5 MCP

#### 是否内置

是。MCP 是外部系统连接 ThreadBeacon 的能力。

#### 是否暴露

- 对研究员：不暴露。
- 对 Lead：只显示“外部工具连接已启用 / 未启用”。
- 对 Admin / Developer：完整暴露 MCP endpoint、PAT、scope、调用日志。

#### 产品化表达

不要在主导航叫 MCP。  
推荐叫：

> 开发者接口

或者：

> 外部工具连接

#### 不应该做

- 不要把 MCP 放在普通项目主路径。
- 不要让用户为了跑研究先配置 MCP。

---

### 7.6 Dify

#### 是否内置

是，可以作为迁移和兼容能力内置。

#### 是否暴露

- 对研究员：不暴露。
- 对 Lead：可以看到“导入已有 Dify 流程”。
- 对 Automation Owner：暴露 Dify 导入报告、阻断节点、映射结果。

#### 产品化表达

不要叫 Dify DSL。  
推荐叫：

> 导入 Dify 流程

#### 需要强调

Dify code/tool/plugin/agent/loop 在隔离沙箱前默认阻断，这是正确的。  
UI 上要明确显示：

- 已支持节点
- 已阻断节点
- 为什么阻断
- 如何替代

#### 不应该做

- 不要暗示所有 Dify 流程都能直接运行。
- 不要把导入放成一级核心入口。

---

### 7.7 Browser Profile

#### 是否内置

是。Browser Profile 是登录态留在 Worker 的关键安全边界。

#### 是否暴露

- 对研究员：在“来源授权”时以“账号授权”方式暴露。
- 对 Lead：显示某来源是否需要授权、授权是否有效、影响哪些流程。
- 对 Admin：暴露 Profile kind、绑定站点、noVNC 安全入口、CDP 证明状态。

#### 产品化表达

不要默认叫 Browser Profile。  
推荐叫：

> 来源账号授权

管理员详情里再显示：

> Browser Profile

#### 必须保留的安全信息

- anonymous / authenticated 区分
- 登录态只留在 Worker
- 控制面不保存平台账号密码
- CDP 不对公网暴露
- noVNC 需要受控访问

#### 不应该做

- 不要把 CDP URL、runtime_json、attestation_json 原样暴露给普通研究员。
- 不要让用户误以为平台账号凭据存在控制面。

---

## 8. 关键用户旅程

### 8.1 团队首次使用

```text
管理员登录
  ↓
创建团队工作区 / 使用默认工作区
  ↓
系统检查：数据库、对象存储、执行节点、模型凭据
  ↓
如无执行节点，显示复制命令
  ↓
邀请研究成员
  ↓
创建第一个研究项目
  ↓
选择模板：竞品研究 / 市场舆情 / 内容趋势 / 空白
  ↓
接入默认来源
  ↓
试运行来源
  ↓
运行默认研究流程
  ↓
生成第一份报告
  ↓
分享给团队 / 配置定时追踪
```

### 8.2 研究员日常使用

```text
进入今天
  ↓
查看待处理与最近报告
  ↓
打开项目
  ↓
查看运行状态和新增数据
  ↓
复核证据
  ↓
打开报告
  ↓
复制结论 / 导出 / 反馈问题
```

### 8.3 研究负责人配置流程

```text
创建项目
  ↓
定义研究目标
  ↓
配置多个来源
  ↓
选择研究流程模板
  ↓
调整 Gate / Filter / 交付规则
  ↓
发布流程版本
  ↓
设置定时运行
  ↓
处理失败和待确认动作
```

### 8.4 管理员维护系统

```text
进入团队与系统
  ↓
查看执行节点
  ↓
检查 Worker 能力和心跳
  ↓
配置 Browser Profile / 来源授权
  ↓
配置 OIDC / PAT / MCP
  ↓
查看审计日志
  ↓
处理节点离线、凭据缺失、交付失败
```

---

## 9. 功能需求

## 9.1 系统就绪检查

### 目标

用户进入后立即知道系统能不能跑研究。

### 需求

系统状态必须拆分：

| 状态 | 展示 |
|---|---|
| 控制面异常 | 控制面连接异常 |
| 数据库 / 对象存储异常 | 存储不可用 |
| 无执行节点 | 执行节点未配置 |
| 执行节点离线 | 执行节点离线 |
| 无可用平台能力 | 来源能力未就绪 |
| LLM 凭据缺失 | AI 分析未配置 |
| 一切正常 | 系统可运行 |

### 验收

- 无 Worker 时，主 CTA 不应是“新建采集任务”。
- 无 Worker 时，展示注册命令和文档入口。
- Worker 离线时，首页待处理必须显示。
- 控制面正常但执行层不可用时，不得显示“系统可运行”。

---

## 9.2 团队工作区与成员

### 目标

团队产品必须支持成员加入、角色控制、工作区切换。

### 需求

1. 提供工作区入口。
2. 显示当前工作区名称和当前角色。
3. 支持 owner 邀请成员。
4. 支持邀请链接接受。
5. 支持 workspace 切换。
6. 前端请求带 `X-Workspace-Id`。
7. viewer 只读时，写按钮禁用并说明原因。

### 角色

| 角色 | 权限 |
|---|---|
| Owner | 管理成员、系统设置、项目、自动化、交付 |
| Editor | 创建项目、来源、流程、运行任务、处理报告 |
| Viewer | 查看项目、记录、报告、证据、审计摘要 |

### 验收

- Owner 创建邀请后，链接可打开。
- 被邀请用户登录后可接受邀请。
- 接受后进入对应工作区。
- 切换工作区后，项目、来源、报告变为对应工作区数据。
- Viewer 无法提交写请求，且界面有明确提示。

---

## 9.3 项目创建与模板

### 目标

项目是研究团队的核心工作容器。

### 需求

创建项目时选择模板：

- 市场舆情监测
- 竞品研究
- 内容趋势雷达
- 空白项目

模板应自动生成：

- 默认来源配置建议
- 默认研究流程
- 默认报告结构
- 默认交付建议

### 验收

- 创建项目后，不落到空白死胡同。
- 项目页展示下一步：接入来源 / 运行示例 / 创建流程。
- 模板为空或后端异常时，使用“空白项目”兜底。

---

## 9.4 来源接入与试运行

### 目标

让团队清楚知道哪些来源能用、哪些需要配置。

### 需求

来源卡片展示：

- 来源名称
- 类型
- 状态
- 最近成功时间
- 连续失败次数
- 最后错误
- 是否需要 API Key
- 是否需要账号授权
- 是否需要执行节点能力

平台状态需要产品化：

| 状态 | 说明 |
|---|---|
| 可直接使用 | 无需额外凭据或 Profile |
| 需要 API Key | 需要在 Worker 环境变量配置 |
| 需要账号授权 | 需要 Browser Profile / 自有账号 |
| 需要执行节点 | 当前没有 Worker 能力 |
| 未验收 | 代码存在，但没有真实环境验收 |
| 不建议承诺 | 合规或平台授权边界不清 |

### 验收

- 用户不能误以为目录里所有平台都可直接使用。
- 来源试运行失败后显示可行动错误。
- 试运行成功后提示创建或绑定工作流。

---

## 9.5 研究流程

### 目标

让普通研究员能运行流程，让高级用户能编排流程。

### 需求

普通模式展示线性流程：

```text
来源 → 标准化 → 去重 → 聚类 → AI 总结 → 证据报告
```

高级模式展示 DAG 画布。

流程需要版本化：

- 草稿
- 已发布版本
- 运行版本
- 修改记录

### 验收

- 新项目可一键生成默认流程。
- 不发布时不能运行。
- 发布前校验节点字段。
- 多来源汇聚连线正确。
- 普通用户不需要拖 DAG 也能运行。

---

## 9.6 运行与 Trace

### 目标

运行过程要让团队相信系统正在工作，并能定位失败。

### 需求

运行页展示：

- 当前状态
- 每个来源任务状态
- 每个流程节点 checkpoint
- 错误原因
- 重试 / 取消入口
- 事件时间线

需要自动刷新：

- 运行中时自动刷新
- 离开运行页停止刷新
- 完成 / 失败后停止刷新

### 验收

- 用户点击运行后无需手动刷新即可看到状态变化。
- 失败任务能看到最后错误。
- Trace 能关联到 workflow run 和 job。

---

## 9.7 报告中心

### 目标

报告是团队成果，不是 API 文件。

### 需求

报告详情页展示：

- 报告标题
- 项目
- 关键词 / 主题
- 来源平台
- 数据量
- 生成时间
- 核心发现
- 痛点 / 主题列表
- Top 证据
- 原文链接
- 运行版本
- 下载 JSON / CSV
- 复制摘要
- 创建定时追踪
- 配置交付

### 验收

- Dashboard 最近成果进入报告详情页，而不是直接下载 JSON。
- 报告页可以回到原始记录。
- 报告页可以看到运行来源和版本。
- JSON 下载仍保留为高级操作。

---

## 9.8 待处理中心

### 目标

团队需要一个地方处理所有阻塞。

### 需求

今天页待处理包括：

- 失败任务
- 离线执行节点
- 无执行节点
- 暂停计划
- 来源测试失败
- Skill 待确认动作
- Skill 纠错提案
- 交付失败
- Browser Profile 失效
- Dify 导入阻断节点

### 验收

- 自动化流程被人工确认卡住时，首页必须显示。
- 交付失败时，首页必须显示。
- 节点离线影响项目时，能跳转到节点详情。

---

## 9.9 自动化 Skill

### 目标

把团队研究方法沉淀成可复用能力。

### 需求

Skill 页面分两层：

#### 普通层

- 可用自动化助手
- 适用项目
- 当前版本
- 最近运行
- 待确认动作

#### 高级层

- SKILL.md
- 九要素
- 不可变版本
- 执行证据
- 纠错提案
- 回滚

必须提供模板：

- 官网观测
- 报告整理
- 竞品跟踪
- 舆情主题归纳

### 验收

- 空状态不直接展示空白九要素表单。
- 风险确认展示 action JSON 和 risk reason。
- “批准一次”和“拒绝并终止”不可被视觉隐藏。
- 发布后版本不可变。

---

## 9.10 Browser Profile / 来源账号授权

### 目标

既支持需要登录态的自有账号来源，又不让凭据边界变模糊。

### 需求

普通产品表达：

> 来源账号授权

管理员详情表达：

> Browser Profile

展示内容：

- 授权名称
- 授权类型：匿名 / 自有账号
- 绑定站点
- 绑定 Worker
- 最近验证时间
- 状态
- 影响的来源和项目

### 验收

- 普通研究员不看到 CDP URL。
- 控制面不回显平台账号密码。
- authenticated 和 anonymous 明确区分。
- GEO 只能使用 anonymous Profile。

---

## 9.11 Dify 导入

### 目标

帮助团队迁移已有 Dify 工作流，但不制造“完全兼容”的错觉。

### 需求

Dify 导入页展示：

- 上传 YAML
- 选择项目
- 选择数据源
- 导入结果
- 已映射节点
- 已阻断节点
- 阻断原因
- 替代建议

### 验收

- code/tool/plugin/agent/loop 没有隔离沙箱时必须阻断。
- 阻断不是失败，而是安全结果。
- 导入后能进入工作流草稿。

---

## 9.12 MCP / 开发者接口

### 目标

让外部工具可接入，但不干扰研究员。

### 需求

放入团队与系统 / 开发者接口。

展示：

- MCP endpoint
- 可用 tools
- PAT 列表
- scope
- 过期时间
- 撤销
- 最近使用

### 验收

- PAT 明文只显示一次。
- scope 清晰可读。
- 撤销后不可调用。
- 普通研究员默认不看到 MCP 配置。

---

## 9.13 自动交付

### 目标

让研究结果能自动触达业务方。

### 需求

交付规则支持：

- Webhook
- 飞书
- 钉钉
- 企业微信
- Email HTTPS Gateway

展示：

- 规则名称
- 渠道
- 绑定项目 / 流程
- 启用状态
- 最近投递结果
- 失败重试记录

### 验收

- Endpoint 必须 HTTPS 公网地址。
- 凭据加密保存。
- 失败日志可查。
- 首页待处理显示交付失败。

---

## 10. 页面改版要求

### 10.1 今天页

目标：团队工作台首页。

必须展示：

- 团队系统状态
- 今日运行数
- 新增记录数
- 在线执行节点
- 待处理事项
- 最近报告
- 最近运行

主 CTA：

- 系统就绪：开始研究项目
- 无执行节点：配置执行节点
- 无来源：接入数据来源
- 有待确认：处理待确认动作

---

### 10.2 项目页

目标：研究项目的主工作区。

必须展示：

- 项目目标
- 项目成员 / 角色摘要
- 来源
- 流程
- 运行
- 证据
- 报告
- 定时计划
- 交付

普通模式隐藏复杂 DAG。高级模式可展开。

---

### 10.3 报告页

目标：团队消费成果。

必须展示：

- 可读摘要
- 关键发现
- 证据链
- 原文链接
- 运行版本
- 导出和交付动作

不要默认只返回 JSON。

---

### 10.4 自动化页

目标：管理团队自动化能力。

必须展示：

- 可用自动化助手
- 模板
- 待确认动作
- 运行证据
- 版本
- 纠错 / 回滚

高级编辑入口再展示 SKILL.md 和九要素。

---

### 10.5 团队与系统页

目标：管理员和自动化负责人使用。

必须展示：

- 成员与角色
- 工作区切换
- 执行节点
- 来源账号授权
- MCP / PAT
- Dify 导入
- Webhook / Delivery
- 审计日志

---

## 11. 优先级

### P0

| 需求 | 原因 |
|---|---|
| 团队定位统一 | 当前个人 / 团队叙事冲突 |
| 系统就绪检查 | 无 Worker 会直接阻断首次价值 |
| 团队工作区与邀请闭环 | 研究团队产品必须可协作 |
| Workspace 切换 | 被邀请成员否则看不到团队数据 |
| 开始研究项目主路径 | 统一 Dashboard 和 Studio 心智 |
| 默认研究流程模板 | 不让用户从空白 DAG 开始 |
| 报告详情页 | 报告是核心成果，不应只是 JSON |
| 待处理中心纳入 Skill / 交付 / Worker | 团队需要集中处理阻塞 |
| OIDC URL 使用后端返回值 | 企业登录不能固定地址 |

### P1

| 需求 | 原因 |
|---|---|
| Skill 模板 | 降低自动化使用门槛 |
| Studio tab URL 化 | 团队协作需要可分享链接 |
| 运行页自动刷新 | 增强运行可信度 |
| 移动端二级导航 | 避免 Studio tab 在窄屏消失 |
| 平台状态产品化 | 减少来源配置误解 |
| 来源账号授权产品化 | 隐藏 Browser Profile 技术细节 |
| Dify 导入报告 | 明确支持和阻断边界 |
| MCP 放入开发者接口 | 不干扰研究员主路径 |

### P2

| 需求 | 原因 |
|---|---|
| 搜索索引 / 导出上限 | 数据量增长后保护证据检索体验 |
| Delivery bounded executor | 避免慢 webhook 占用异步线程 |
| control-plane typecheck | 提升前端交付质量 |
| CHANGELOG | 发布流程完整性 |
| 报告评论 / 复核状态 | 团队协作增强，但不是首要闭环 |

---

## 12. 技术改动映射

| 产品需求 | 最小技术动作 |
|---|---|
| OIDC URL | `LoginPage` 接收并使用 `oidcUrl` |
| 邀请闭环 | 增加 `/invite` 页面，调用 `/api/access/invitations/accept` |
| Workspace 切换 | `auth-client.ts` 注入 `X-Workspace-Id`，UI 调 `/api/access/workspaces` |
| Worker 阻塞态 | Dashboard 根据 `totalNodes/onlineNodes/availableSlots` 调整 CTA 和状态 |
| 报告详情页 | 前端新增 `/reports/:id` 或 hash 路由；后端可先复用 `/api/reports/:id` JSON |
| Skill 待确认 | Dashboard 增加 `/api/skills` 或后端聚合字段 |
| Studio 自动刷新 | `runs/resources/evidence` tab 开启轮询 |
| Tab URL | 使用 hash：`/studio#runs`、`/studio#evidence` |
| 前端类型检查 | control-plane 增加 `typecheck` script，根 `check` 调用 |
| 工作流事务 | `PlatformService.run()` 中 job insert 和 run insert 合并事务 |

---

## 13. opencli-Razormind 工程化思想参考

参考项目：`E:/myide/opencli-Razormind`。本 PRD 只借鉴工程化思想，不复制代码、不照搬依赖栈。

### 13.1 可借鉴的核心思想

#### 13.1.1 先锁定完整产品闭环

Razormind 的公开主路径是：

```text
Project → Workflow → Run → Records / Evidence → Delivery
```

ThreadBeacon 团队版应收敛为：

```text
研究问题 → 团队项目 → 来源接入 → 研究流程 → 运行追踪 → 证据报告 → 复核 / 交付
```

产品判断：

- 用户主对象是项目，不是任务。
- 用户核心结果是报告，不是 JSON。
- 运行过程必须能回放和诊断。
- 交付必须是研究闭环的一部分，不是附加按钮。

参考证据：

- `E:/myide/opencli-Razormind/README.md`
- `E:/myide/opencli-Razormind/CONTEXT.md`

---

#### 13.1.2 产品对象压过技术对象

Razormind 文档明确区分 Product Language 和技术实现对象。ThreadBeacon 应沿用这个思想：

| 技术对象 | 团队产品对象 |
|---|---|
| Worker | 执行资源 / 执行节点 |
| Job / Task | 运行中的执行任务 |
| DAG | 研究流程 |
| Skill runtime | 自动化助手能力 |
| Browser Profile | 来源账号授权 |
| MCP | 开发者接口 / 外部工具连接 |
| Dify DSL | 导入的自动化流程 |
| Raw records | 证据材料 / 数据记录 |

产品要求：

- 研究员主路径只出现产品对象。
- 管理员和自动化负责人可以展开技术对象。
- API、日志、调试页可以保留技术名，但 UI 主文案不用实现名教育用户。

参考证据：

- `E:/myide/opencli-Razormind/CONTEXT.md`
- `E:/myide/opencli-Razormind/docs/backend-capability-frontend-integration-PRD.md`

---

#### 13.1.3 能力归宿台账

Razormind 用机器可读台账把后端能力归类，避免“端点写好了但 UI 没接”“内部端点被做成人工按钮”。ThreadBeacon 应建立同类台账。

建议新增：

```text
docs/threadbeacon-capability-exposure-matrix.yaml
```

每个后端能力只能属于一种归宿：

| 归宿 | 含义 | 示例 |
|---|---|---|
| `operator_ui` | 团队成员日常需要操作 | 项目、来源、报告、运行、待处理 |
| `studio_binding` | 只通过研究流程绑定 | Source node、Agent node、Deliver node |
| `setup_status` | 只展示就绪状态和配置入口 | Worker、模型 Provider、Browser Profile |
| `machine_ingress` | 外部系统 / Agent 调用 | Webhook trigger、MCP tool call、Worker 注册 |
| `internal_only` | 运行时内部契约 | 租约、checkpoint、trace artifact 写入 |
| `retire` | 明确废弃或兼容保留 | 旧 TypeScript 控制面接口 |

验收要求：

- 新增 API 能力必须进入台账。
- 新增 UI 入口必须说明它消费哪个能力归宿。
- `machine_ingress` 不做普通人工按钮。
- `internal_only` 不出现在主导航。
- `retire` 必须有删除或迁移说明。

参考证据：

- `E:/myide/opencli-Razormind/docs/backend-capability-exposure-matrix.yaml`
- `E:/myide/opencli-Razormind/docs/backend-capability-frontend-integration-PRD.md`

---

#### 13.1.4 能力就绪度，而不是安装即完成

Razormind 的 `Capability Readiness` 思想适合 ThreadBeacon：平台能力不能只看“代码存在”或“插件安装”，要看它对当前项目是否真的可用。

ThreadBeacon 应分两层就绪度：

##### Workspace Capability Readiness

回答：团队工作区是否具备某类能力。

例如：

- 是否有在线执行节点。
- 是否有可用模型凭据。
- 是否有 Reddit / YouTube API Key。
- 是否有匿名 Browser Profile。
- 是否有自有账号授权。
- 是否有可用交付通道。

##### Project Readiness

回答：当前项目的流程能不能运行。

只检查项目实际依赖，不拿无关能力吓用户。

例如一个 RSS 项目不应因为 TikHub key 缺失而显示未就绪。

状态模型：

| 状态 | 含义 |
|---|---|
| `ready` | 当前项目可运行 |
| `missing_resource` | 缺 Worker / Profile / key / source |
| `blocked_by_policy` | 合规或权限阻断 |
| `needs_approval` | 需要人工确认 |
| `degraded` | 可运行但有风险，例如交付通道失败 |
| `unknown` | 后端无法确认，需要探测 |

参考证据：

- `E:/myide/opencli-Razormind/CONTEXT.md`
- `E:/myide/opencli-Razormind/docs/CONTROL_THEORY_ARCHITECTURE.md`

---

#### 13.1.5 Draft / Validate / Publish / Run 生命周期

Razormind 的工程思想是：草稿可改，发布版本不可变，运行绑定具体版本。

ThreadBeacon 应明确：

| 阶段 | 产品含义 | 技术约束 |
|---|---|---|
| Draft | 研究流程草稿，可随时编辑 | 保存 revision |
| Validate | 检查来源、权限、节点、凭据、执行资源 | 产出 readiness / blocked reasons |
| Publish | 发布不可变流程版本 | version 固化 spec |
| Run | 按发布版本运行 | run 绑定 workflow version |
| Evidence | 从 run 事实投影证据 | 不手写孤立结论 |
| Report | 从 evidence / records 生成报告 | 报告引用 run/version/source |

验收要求：

- 未发布流程不能进入定时运行。
- 报告必须显示运行版本。
- 修改草稿不能影响已发布版本。
- 自动化执行必须绑定已发布版本。

参考证据：

- `E:/myide/opencli-Razormind/backend/api/v1/studio_lifecycle.py`
- `E:/myide/opencli-Razormind/docs/adr/0020-pin-capability-versions-in-executable-definitions.md`

---

#### 13.1.6 Run Inbox，而不是日志墙

Razormind 的 Collection Operations 思想是：不要做“钟表铺”式 dashboard，应该把需要人处理的运行状态变成 Inbox。

ThreadBeacon 团队版应把“今天”页升级为 Team Inbox + System Pulse。

Inbox 条目包括：

- 失败运行
- 空结果运行
- 长时间 queued
- Worker 离线
- 来源授权失效
- Skill 待确认动作
- Skill 纠错提案
- 交付失败
- Dify 导入阻断节点
- 报告待复核

Inbox 状态建议：

| 状态 | 含义 |
|---|---|
| `running` | 正在执行，可观察 |
| `needs_attention` | 需要人工处理 |
| `ready_to_review` | 有结果，等待复核 |
| `resolved` | 已处理 |
| `ignored` | 明确忽略 |

注意：Inbox 状态是人的处理状态，不替代后端 job/run 的执行事实。

参考证据：

- `E:/myide/opencli-Razormind/docs/COLLECTION_OPERATIONS_CONSOLE.md`
- `E:/myide/opencli-Razormind/CONTEXT.md`

---

#### 13.1.7 能力投影：真实、阻断、预览、设计态

Razormind 在 workflow capability mapping 中强调：可见节点必须标明真实运行状态。ThreadBeacon 也应这样处理 DAG / Skill / Dify / Provider 能力。

节点或能力状态：

| 状态 | 含义 | UI 行为 |
|---|---|---|
| `real` | 已有真实 runtime binding | 可运行 |
| `blocked` | 需要资源或策略解除 | 展示缺口和修复动作 |
| `preview` | 可配置但不能完整运行 | 可预览，不可发布 |
| `design` | 仅设计/导入词汇 | 不能作为可运行能力展示 |

验收要求：

- 不能把没有 runtime binding 的节点标成可运行。
- Dify 导入节点如果被阻断，要显示原因。
- Worker/Profile/key 缺失时，节点显示 blocked，不让用户填 raw cookie 或 runtime_json。

参考证据：

- `E:/myide/opencli-Razormind/docs/workflow-node-capability-mapping.md`
- `E:/myide/opencli-Razormind/backend/workflow/capability_projection.py`

---

#### 13.1.8 凭据与执行授权分层

Razormind 的凭据思想是：Connection → Binding → Execution Grant。ThreadBeacon 目前已有“凭据留在 Worker”的正确方向，但团队版需要更产品化。

建议模型：

| 层 | ThreadBeacon 对象 | 含义 |
|---|---|---|
| Workspace Connection | 团队来源账号 / API Key 引用 | 团队拥有的连接能力 |
| Project Binding | 项目授权使用某连接 | 项目可用范围 |
| Node Scope | 节点声明需要的最小能力 | 例如只读搜索、只读抓取 |
| Execution Grant | 单次运行短授权 | 只对一次 run / node 生效 |

验收要求：

- 项目不复制 secret。
- 节点不保存 raw credential。
- Worker 执行时只拿本次所需授权。
- 审计日志能说明谁授权、哪个项目、哪个节点、哪次运行。

参考证据：

- `E:/myide/opencli-Razormind/CONTEXT.md`
- `E:/myide/opencli-Razormind/docs/adr/0022-credentials-narrow-to-ephemeral-node-execution-grants.md`

---

#### 13.1.9 外部交付分清“提交成功”和“业务成功”

Razormind 明确区分 Delivery Execution Result 与 Business Outcome。ThreadBeacon 的 Webhook / 飞书 / 钉钉 / 企微 / Email 交付也需要这个分层。

建议：

| 层 | 含义 |
|---|---|
| Delivery Attempt | 某次 HTTP / 消息发送尝试 |
| Execution Result | 技术提交结果，例如 2xx / 429 / timeout |
| Business Outcome | 业务结果，例如已送达 / 被拒收 / 待确认 / 未知 |
| Operation ID | 一次业务交付意图的稳定 ID，重试复用 |

验收要求：

- HTTP 200 不直接等于“业务已完成”。
- 重试不能生成多个业务意图。
- 未知结果不能盲目无限重试。
- 失败或未知进入 Team Inbox。

参考证据：

- `E:/myide/opencli-Razormind/docs/adr/0021-delivery-separates-submission-from-business-outcome.md`
- `E:/myide/opencli-Razormind/docs/adr/0023-external-side-effects-have-stable-operation-identity.md`

---

#### 13.1.10 控制论：先让传感器诚实，再做自动控制

Razormind 的控制论文档很适合 ThreadBeacon 的 Worker / 来源 / 运行治理。

工程原则：

> 自动化调度、降频、暂停、恢复之前，必须先保证 run_events、错误类型、cursor、delivery logs 是可信传感器。

ThreadBeacon 应采用：

1. 所有失败分类：`transient`、`permanent`、`auth`、`rate_limit`、`schema_drift`、`policy_blocked`、`backpressure`。
2. 所有自动动作先 advisory，后 automatic。
3. 自动暂停 / 降频 / 切换来源必须写审计。
4. cursor 只能在 durable write 成功后推进。
5. 控制动作必须可解释：为什么调、调了什么、调前指标、调后指标。

参考证据：

- `E:/myide/opencli-Razormind/docs/CONTROL_THEORY_ARCHITECTURE.md`

---

### 13.2 对 ThreadBeacon 的具体落地

#### 13.2.1 新增 Setup Center

团队版需要一个持久存在的“设置中心”，不是一次性 onboarding。

Setup Center 展示：

- 执行节点是否就绪
- 模型 Provider 是否可用
- 来源能力是否可用
- Browser Profile / 来源账号授权是否有效
- 交付通道是否可用
- 工作区成员与 OIDC 是否可用
- 当前项目缺什么

入口：`团队与系统 → 设置中心`。

---

#### 13.2.2 新增 Capability Exposure Matrix

建立 `docs/threadbeacon-capability-exposure-matrix.yaml`。

第一批覆盖：

- `/api/dashboard`
- `/api/studio`
- `/api/workflows/*`
- `/api/jobs/*`
- `/api/skills/*`
- `/api/browser/*`
- `/api/integrations/*`
- `/api/mcp`
- `/api/admin/access`
- `/api/access/workspaces`
- `/api/access/invitations/accept`

目的：

- 明确哪些该给人用。
- 哪些只给机器用。
- 哪些只是内部 runtime。
- 哪些应该退役。

---

#### 13.2.3 项目页使用两层流程视图

普通研究员看到：

```text
来源 → 清洗 → 聚类 → AI 总结 → 证据报告 → 交付
```

自动化负责人点击“高级流程画布”后才看到 DAG 节点、边、Gate、Agent、Deliver 配置。

---

#### 13.2.4 能力缺口要变成可行动 blocked reason

示例：

```text
当前流程无法运行：YouTube 来源需要 YOUTUBE_API_KEY。
操作：在 Worker 环境变量中配置后刷新执行节点。
```

```text
当前流程无法运行：GEO 节点需要 anonymous Browser Profile。
操作：到 来源账号授权 创建匿名 Profile，并绑定健康 CDP Worker。
```

```text
当前流程无法运行：Skill 节点绑定的 Skill 尚未发布。
操作：发布 Skill 或替换为已发布版本。
```

---

#### 13.2.5 报告必须绑定证据投影

报告页不要直接渲染孤立 JSON。

最小可行字段：

- report id
- project id
- workflow id
- workflow version
- run id
- source ids
- evidence ids
- record ids
- artifact refs

字段缺失时可以降级显示，但要提示“证据投影不完整”。

---

#### 13.2.6 Agent / MCP / Web UI 共用同一控制边界

MCP 不应该拥有另一套业务逻辑。Agent、MCP、Web UI 都应该走同一组后端能力与权限检查。

要求：

- Web 上能做的受控操作，MCP 可以在有 scope 时做。
- MCP 做的操作也进入 audit。
- Agent 提案执行前重新校验 revision、权限、连接和策略。
- 高风险动作仍进入 Team Inbox / human approval。

参考证据：

- `E:/myide/opencli-Razormind/CONTEXT.md`
- `E:/myide/opencli-Razormind/docs/adr/0042-expose-capabilities-through-an-api-first-agent-loop.md`

---

### 13.3 不应该照搬的部分

| 不照搬 | 原因 |
|---|---|
| 大型前端依赖栈 | ThreadBeacon 当前 React/Vite/原生 CSS 已够用，先别加 UI 库 |
| Canvas-first 默认入口 | 研究团队主路径是项目和报告，不是画布 |
| 每个后端端点一个页面 | 会制造孤儿能力和信息架构膨胀 |
| 过深兼容运行时 | Dify/MCP/Browser/Skill 是能力，不是单独产品壳 |
| 历史目标架构 | Razormind 文档中部分 Next/Hono/Turborepo 是历史设想，不能照抄 |
| raw OpenCLI / CDP / cookie 配置心智 | ThreadBeacon 要表达为来源、授权、执行资源 |

---

## 14. 非目标

当前优化不做：

- 新增大型 UI 组件库。
- 新增未验证平台承诺。
- 开放任意代码执行。
- 绕过平台签名、登录态或 ToS 限制。
- 把所有高级能力做成模板市场。
- 把 MCP / Dify / Browser Profile 放到普通研究员主路径。

---

## 15. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 团队定位导致复杂度上升 | 需要成员、角色、工作区 | 只补闭环，不做复杂组织架构 |
| 高级能力被隐藏后难发现 | Admin 需要配置 Worker/MCP/Dify | 放入“团队与系统”，而不是删除 |
| 平台状态表达影响销售预期 | 有些来源未验收或需要凭据 | 明确状态标签，避免误承诺 |
| 报告页需要解析 JSON | 不同报告结构可能不一致 | 先做通用报告渲染，字段缺失时降级 |
| Skill 模板质量不足 | 模板差会误导用户 | 先做 2-4 个内置模板，不做市场 |

---

## 16. 最终产品决策

1. ThreadBeacon 明确面向研究团队，而不是单人玩具。
2. 主路径从“采集任务”改为“研究项目”。
3. Worker、DAG、Skill、MCP、Dify、Browser Profile 全部内置。
4. 普通研究员不直接面对这些实现概念。
5. 管理员和自动化负责人可以在高级入口完整配置。
6. 团队协作、工作区切换、邀请接受是团队版 P0。
7. 报告必须产品化为可读、可复核、可交付资产。
8. 首页待处理必须覆盖所有会阻塞研究交付的事项。

一句话：

> 研究员用“项目、来源、流程、报告、证据”；管理员才用“执行节点、Profile、MCP、Dify、Skill 高级配置”。
