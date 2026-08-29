# ThreadBeacon

Agent 化研究与情报工作流平台：从多平台采集**公开**内容，经过标准化、证据关联、语义聚类、
LLM/Skill 多步研究与 GEO 官网观测，形成可审计、可交付的情报资产。既可作为 CLI 单机运行，
也可由 Java Web 控制平面和多个 TypeScript Worker 组成分布式平台。

Web 控制面现已提供项目模板与真实来源运行时、可视化多来源 DAG（分支/汇聚）、草稿与不可变发布版本、
节点级检查点和事件追踪、证据与记录关系投影、执行节点/浏览器配置档案、插件能力目录、
定时与 Webhook 触发、加密投递规则及审计日志。RSS/Atom、只读 REST API 与公开网页可以登记、试运行、
绑定工作流并持久化增量游标。当前默认自托管控制面已经切换为 Java；Java 主链路已包含企业 OIDC、
安全 Dify DSL 导入、带 scope 的 PAT Bearer 鉴权与可调用的 MCP tools。旧 TypeScript 控制面已移除。

License: Apache-2.0 · Node ≥ 22 · TypeScript strict

> ⚠️ **部署前请先读 [`DISCLAIMER.md`](./DISCLAIMER.md)。**
> 本项目自身的 HTTP 层拒绝登录态凭据，也不含任何签名逆向代码；可选 OpenCLI / Spider_XHS
> 外部适配器会复用运行者自己的浏览器会话。项目**完整保留原文、作者、
> 原帖链接与精确时间戳**，落盘产物属个人数据。开源发布不构成"在你的辖区使用它
> 是合法的"这一主张，GDPR / 个保法 / 平台 ToS 的义务归**运行它的人**。

## 凭据边界

1. **ThreadBeacon 自己发出的请求不带用户会话凭据。** `PoliteHttpClient` 在任何
   `AuthMode` 下都拒发 `Cookie`，命中即抛错，只能改源码绕过。
   依据：Meta v. Bright Data（登出抓公开数据）胜诉，Meta v. Voyager Labs
   （登录态 + 假账号）被判永久禁令。
   > `app-credential` 指平台签发给应用的凭据（Reddit OAuth、YouTube API key），
   > 官方 API 是最合规的取数路径，与登录态采集性质完全不同。
2. **无签名逆向。** 本项目不含 `x-s` / `a_bogus` / `x5sec` 及同类实现。
   直接原因是「丁某案」——破解抖音 X-Gorgon 被认定为"专门用于侵入计算机信息系统
   的程序"，判缓刑（见 `docs/技术选型调研.md`）。
3. ⚠️ **外部适配器可能使用登录态。** Spider_XHS 和 OpenCLI 以独立子进程运行，
   可复用你**自有账号**的浏览器会话；provenance 会如实记为
   `user-authorized` / `user-session`。OpenCLI 写操作、下载、敏感字段和输出路径
   在分析任务入口被拒绝。
   风险定性见 [`DISCLAIMER.md`](./DISCLAIMER.md) §1——它落在上述两个判例之间，
   没有可直接援引的有利先例。

## 数据保留

采集到的字段尽量提取完整，归一到 `SourceItem`：

| 字段 | 内容 |
|---|---|
| `text` / `title` | 原文与标题，不改写 |
| `author` / `authorId` | 显示名或 handle、平台内稳定 ID |
| `url` | 原帖链接 |
| `postedAt` / `timeBucket` | 精确发布时刻，以及派生的日期 |
| `itemType` / `parentId` | 帖子还是评论；评论指回所属帖子 |
| `metrics` | 点赞 / 评论 / 转发 / 播放 |
| `raw` | 平台特有字段原样留存 |

丢字段比多留字段更难补救 —— 重新采集要重新烧配额，而原帖可能已经删了。

## 目录

```
src/
  cli.ts             命令行入口（doctor / analyze / list / export）
  runtime.ts         CLI / Worker 共用的数据源装配
  worker.ts          远程节点注册、心跳、抢单、执行与结果回传
  net/proxy.ts       进程级代理，一并覆盖 LLM SDK 的出站请求
  providers/         数据接入层
    types.ts           Platform × ProviderKind 二维契约、SourceItem、Provenance
    item.ts            SourceItem 的构造入口
    registry.ts        按 (platform, kind) 索引，按合规优先级 resolve
    http.ts            限流 + 凭据分档的 HTTP 客户端
    base.ts            provenance 构造与打包的唯一出口
    bluesky-jetstream.ts  AT Protocol 实时流（无需凭据）✅ 实测可用
    bluesky.ts         AT Protocol 历史检索 ⛔ 实测 403，需用户凭据
    reddit.ts          官方 Data API（OAuth client_credentials）
    youtube.ts         Data API v3，含评论
    external.ts        只承载 authMode 的占位端口，给不走 HTTP 层的 provider 用
    opencli.ts          动态发现 OpenCLI 站点与只读命令、通用字段归一化和安全护栏
    generic-web.ts      RSS / REST / Web 运行时、SSRF 防护、robots 与条件游标
    xiaohongshu/
      spider-xhs.ts      经 Spider_XHS 子进程取数（自有账号登录态）
    tikhub/            第三方聚合供应商，一个 token 三个平台
      client.ts          Bearer 认证 + 响应外壳兜底
      base.ts            分页/评论/打包骨架，子类只填端点与字段映射
      xiaohongshu.ts douyin.ts tiktok.ts
  geo/
    official-site.ts    版本化 GEO 官网观测、匿名 CDP、SSRF/robots 与个性化拒绝
  llm/               LLM 接入层，OpenAI 兼容 / Anthropic Messages 双线路
  clustering/        语义聚类（源自 SeekMoney-ai，MIT，见 NOTICE）
  pipeline/
    analyze.ts         端到端编排
    report.ts          产物类型
    export.ts          CSV 分表与 JSON 全量
    store.ts           落盘
tests/
scripts/             真实凭据的冒烟脚本
apps/control-plane/  React/Vite Web 管理台（静态前端）
apps/control-api/    Java 17 / Spring Boot 控制平面、Flyway 迁移与 PostgreSQL API
docs/                调研与设计文档
reference/           上游只读参考，不入版本库
```

## 命令行

```bash
pnpm doctor                                # 检查数据源可达性与凭据配置
pnpm cli analyze bluesky "battery life" 50 # 跑一次分析并落盘
pnpm cli analyze opencli:hackernews "AI" 20 # 通过 OpenCLI 动态适配器分析
pnpm cli list                              # 列出已有报告
pnpm cli export <目录>                      # 重新导出已有报告
pnpm xhs:login                             # 小红书扫码登录（仅用 Spider_XHS 时需要）
```

## Web 控制平面与分布式执行

当前 Java 控制平面包含本地 Basic 登录、任务队列、周期计划、失败重试/取消、执行节点监控、逐条数据记录、
跨任务去重、搜索、多来源工作流版本与来源级 Trace、证据链、审计日志、Webhook 触发、受控浏览器会话、
GEO 执行和报告下载。任务、工作流、节点、标准化记录与治理数据保存到 PostgreSQL，完整 JSON 报告保存到 S3/MinIO；
采集凭据只留在 Worker，控制平面不保存平台 API key 或浏览器登录态。

通用来源只执行 GET。每个请求都会阻断本机/私网/链路本地/保留地址，对 DNS 结果固定连接，
并在每次重定向后重新校验；网页来源先检查 `robots.txt`，响应体限制为 5 MiB。REST 密钥配置
只保存“HTTP 头 → Worker 环境变量名”的引用，密钥值始终留在执行节点。RSS 会保存 ETag 与
Last-Modified，下一轮自动发出条件请求；来源的最近成功、连续失败和最后错误保存在 PostgreSQL。

```text
浏览器 → React 静态管理台 → Spring Boot 控制平面
                                  ↓
                         PostgreSQL 任务 / 工作流 / 租约
                         ↓ 到期入队 / 抢单 / 心跳
                    多个 ThreadBeacon Worker
                         ↓ 完成回传
                       S3 / MinIO 报告库
```

Docker 是可选部署方式。原生启动仍需要可连接的 PostgreSQL 与 S3/MinIO；安装 Java 17+、Node 22+、
pnpm，并按 `.env.example` 在不入库的 `.env.local` 中填写本机连接和三份独立随机密钥。先检查环境，再用一个命令
启动 Spring Boot API、React 管理台和 Worker：

```bash
pnpm control:doctor
pnpm control:native
```

默认管理台为 `http://127.0.0.1:3000`，API 为 `http://127.0.0.1:8080`；按 `Ctrl+C` 会停止本次启动的三个进程。
环境检查会明确指出缺少 Java、PostgreSQL、MinIO 或端口冲突。若希望分别调试，也可运行
`pnpm control:dev`、`apps/control-api/mvnw spring-boot:run` 与 `pnpm worker`。

如选择容器部署，配置三份独立随机密钥后可一键启动完整轻量自托管栈（控制平面 + Worker + 持久化
Chromium/CDP/noVNC）：

```bash
docker compose up --build -d
```

默认仅监听本机：管理台 `http://127.0.0.1:3000`、浏览器桌面
`http://127.0.0.1:6080/vnc.html`；CDP 只在 Compose 内网提供给 Worker。首次启动所需
密码、密钥、反向代理与数据卷说明见 [`docs/Docker自托管.md`](./docs/Docker自托管.md)。

启动第一台 Worker 前，在控制平面运行环境和 Worker 中设置相同的
`THREADBEACON_NODE_REGISTRATION_KEY`，并给 Worker 配置管理台地址：

```bash
THREADBEACON_CONTROL_URL=http://localhost:8080
THREADBEACON_NODE_NAME=worker-local-01
THREADBEACON_NODE_REGISTRATION_KEY=replace-with-a-long-random-value
pnpm worker
```

首次注册会打印 `THREADBEACON_NODE_ID` 和一次性 `THREADBEACON_NODE_TOKEN`。安全保存这两项后，后续启动
改用它们并删除共享注册密钥。每台节点可独立配置 Reddit、YouTube、TikHub、Spider_XHS 和
LLM 凭据；控制平面只会把平台匹配的任务派给该节点。`THREADBEACON_WORKER_CONCURRENCY` 控制节点槽位数。
`THREADBEACON_BROWSER_PROFILE` 标识该 Worker 使用的浏览器配置名称，`THREADBEACON_BROWSER_PROFILE_KIND`
区分 `anonymous` 与 `authenticated`；同一主机可运行多个不同配置的 Worker，
控制平面按节点能力和并发槽位派发任务。Worker 只发起出站 HTTPS/WSS 连接，因此可跨 NAT/防火墙部署。

无法使用轮询或需要中心主动派发时，可部署 Reverse Agent Gateway：Worker 主动建立带 ACK、心跳、
重连、超时和任务幂等语义的 WebSocket；控制面只通过加密保存的 HTTPS Gateway 地址与 token
派发，不依赖公网入站 TCP。Docker Compose 与 Kubernetes/Helm 集群说明见
[`docs/集群部署.md`](./docs/集群部署.md)，协议见
[`docs/gateway-protocol.md`](./docs/gateway-protocol.md)。Java 控制面的企业目录登录配置见
[`docs/企业OIDC.md`](./docs/企业OIDC.md)。

工作流支持 1–10 个来源和任意无环分支/汇聚。每个来源生成独立任务并按 Worker 能力路由，
控制平面通过 `workflow_run_jobs` 聚合运行状态；任一来源最终失败会停止同运行的其他来源。
运行级取消/重试、节点检查点和事件 Trace 均可在 Studio 中操作。OpenCLI 目录由 Worker 启动时
动态发现并核对实际二进制版本；CDP 未配置或健康检查失败时不会上报依赖浏览器的能力，避免任务
被路由到实际不可执行的节点。当前锁定版本扫描到 171 个只读站点，需要时可为来源显式指定只读 command/args。
GEO 按参考项目的受控能力方式发布 `official-site.observe@1.0.0`，复用现有任务队列、取消/重试、
PostgreSQL 独立执行状态、30 秒租约、S3/MinIO 报告与 Trace；只有配置了健康 CDP、声明
`THREADBEACON_BROWSER_PROFILE_KIND=anonymous` 且通过完整 Cookie jar 空值证明的 Worker 才会上报该能力。
自托管时可用 `docker compose --profile geo up --build -d` 额外启动独立匿名浏览器与 GEO Worker；
它不复用常规登录态浏览器卷，并在每次观测前后清理站点状态。
兼容桥接接口为 `GET /api/v1/internal/geo-acquisition/capabilities`、
`POST /api/v1/internal/geo-acquisition/executions`、`GET .../executions/:id` 与 `POST .../executions/:id/cancel`；
提交接口使用 `(owner, idempotency_key)` 去重，并在键对应不同请求时返回 409。

Java 控制面的 `/api/mcp` 支持初始化、工具发现和工具调用。外部客户端使用仅显示一次的 `threadbeacon_` PAT，
服务端校验过期、撤销、角色与 REST/MCP scopes；当前提供记录查询、工作流运行/查询和 Skill 查询/运行工具。
自动交付对网络错误、HTTP 408/429 与 HTTP 5xx 最多尝试三次，并为每次尝试保留审计记录。
RSS、REST 与公开网页来源会持久化条件请求游标；URL 只支持 `{keyword}`、`{limit}` 两个受限模板。

### 启用小红书

Spider_XHS 无 LICENSE 文件，代码不随本项目分发，需自行安装：

```bash
git clone https://github.com/cv-cat/Spider_XHS
cd Spider_XHS && pip install -r requirements.txt && npm install

# 回到 ThreadBeacon，在 .env.local 里写：
#   SPIDER_XHS_PATH=/abs/path/to/Spider_XHS
pnpm xhs:login                              # 扫码，cookie 存本地
pnpm cli analyze xiaohongshu "粉底液" 50
```

需要 Python 3.10+ 与 Node.js 20+（Spider_XHS 的要求）。
ThreadBeacon 通过 `scripts/spider_xhs_bridge.py`（本仓库原创）以子进程调用它，
双方只交换 JSON，Spider_XHS 的代码不进本仓库。

每次 `analyze` 落一个目录，里面是同一份数据的四种形态：

```
analysis-results/2026-08-05T12-00-00-000Z__reddit__battery-life/
  report.json     完整报告：洞察 + 全量 items + provenance
  posts.csv       帖子表
  comments.csv    评论表，靠 parent_id 关联回 posts
  clusters.csv    聚类表，member_ids 关联回原始记录
```

CSV 带 UTF-8 BOM，Excel 直接打开不乱码；以 `=` `+` `-` `@` 开头的字段会被前缀
单引号，避免 Excel 把它们当公式执行。

网络受限环境请设置 `HTTPS_PROXY` —— 入口会把它装成全局 dispatcher，
一并覆盖 LLM SDK 的出站请求（见 `src/net/proxy.ts`）。

## 跑一次分析

```ts
import { analyze } from './src/pipeline/analyze.js';
import { BlueskyJetstreamProvider } from './src/providers/bluesky-jetstream.js';
import { PoliteHttpClient } from './src/providers/http.js';
import { ProviderRegistry } from './src/providers/registry.js';
import { ClusteringService } from './src/clustering/ClusteringService.js';
import { createLlmClient } from './src/llm/index.js';

// Bluesky 的历史检索需用户凭据（实测 403），用无需授权的实时流
const registry = new ProviderRegistry().register(
  new BlueskyJetstreamProvider({ http: new PoliteHttpClient() }),
);

const report = await analyze(
  { registry, clustering: new ClusteringService(), llm: createLlmClient({ apiKey: KEY, model: 'claude-opus-5' }) },
  { platform: 'bluesky', keyword: '续航', limit: 200 },
);

// report.items 是全量原始记录；painPoints[i].memberIndices 指回它的下标
for (const p of report.painPoints) {
  console.log(p.theme, p.size);
  for (const idx of p.memberIndices) {
    const it = report.items[idx]!;
    console.log(`  ${it.author} ${it.url}`);
  }
}
```

数据源凭据见 `.env.example`。Bluesky Jetstream 零成本零凭据，适合先跑通闭环 ——
代价是只能订阅实时增量，拿不到历史（`mode: 'streamLive'`）。

## LLM 接入

只需 url + key + model 三项，OpenAI 兼容与 Anthropic Messages 两种线路走同一个接口：

```ts
import { createLlmClient } from './src/llm/index.js';

// Anthropic 官方
const a = createLlmClient({ apiKey: KEY, model: 'claude-opus-5' });

// 任意 OpenAI 兼容网关
const b = createLlmClient({
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: KEY,
  model: 'glm-4.6',
});

const out = await b.complete({
  system: '你是需求分析助手',
  messages: [{ role: 'user', content: '把这批评论归纳成痛点' }],
});
if (out.refused) { /* Anthropic 拒答走 HTTP 200，必须先判这里 */ }
console.log(out.text, out.usage);
```

或用 `llmConfigFromEnv()` 从环境变量装配，见 `.env.example`。数值、枚举与 URL 会在
SDK 启动前校验，避免把 `NaN`、非法协议或错误枚举拖到远端请求时才暴露。

多个语义簇默认最多并行归纳 4 个，可用 `LLM_MAX_CONCURRENCY` 调整；这是有界并发，
既消除逐簇串行等待，也不会无上限地冲击模型网关。产物的 `stats` 会记录成功归纳和
跳过的簇数，CLI 遇到拒答、空响应或非法 JSON 时会明确告警。

**为什么是两条线路而不是一个 OpenAI 兼容层**：两边语义实质不同 —— Anthropic 的 `system`
是顶层参数不是消息、`max_tokens` 必填、响应 `content` 是内容块数组、拒答走
HTTP 200 + `stop_reason='refusal'`、当前模型发送 `temperature` 会 400。
套 OpenAI 壳会把这些全丢掉，所以两条链路各用各的官方 SDK，只在 `ILlmClient` 这层统一。

线路格式省略时按 model 前缀与 baseUrl 主机名推断（`claude-*` 或主机名含 `anthropic` 判为
Anthropic，其余归 OpenAI）；接第三方网关建议显式写 `format`。
`thinking` 仅 Anthropic 线路有效，走官方端点默认 `adaptive`，指定自定义 `baseUrl` 时默认关闭 ——
网关未必透传该参数。

## 开发

```bash
pnpm install
pnpm check       # CLI 类型检查 + 199 个测试 + Java 测试 + 控制台 lint/build
```

需要 Node ≥ 22。本地 CLI / Worker 无 Docker 依赖。

重建上游参考仓库：

```bash
git clone https://github.com/liangdabiao/SeekMoney-ai reference/SeekMoney-ai
```

## 当前进度

**已完成**
- 项目骨架：TypeScript strict + `noUncheckedIndexedAccess`、锁定 Node/pnpm、CI，并纳入 Java Maven 测试
- 控制平面：Java 17 + Spring Boot 4.1.1，提供任务/计划/节点/记录/报告 API；PostgreSQL 持久化、
  Flyway 治理、S3/MinIO 报告存储、周期入队、任务取消、自动重试与僵尸任务恢复
- 工作流与治理：可视化多来源 DAG、分支/汇聚、乐观锁草稿、不可变版本发布、持久化节点状态机、
  Agent 异步检查点、运行级取消/重试和节点 Trace；分析主题自动关联原始记录并保存证据关系
- Agent Skill：九要素 Skill、草稿/发布、不可变版本、模型驱动的受控浏览器执行循环、租约恢复、
  单动作人工确认、`journey_trace_v1`、自评证据、连续失败纠错提案、人工重蒸馏/驳回/回滚
- 集成入口：Webhook、Dify DSL 安全导入、带角色/scope 的 PAT Bearer 鉴权，以及可实际调用的 MCP tools；
  Dify 任意代码/插件节点只生成阻断草稿，未经人工替换不能发布
- 安全交付：Webhook、飞书、钉钉、企业微信和 Email HTTPS Gateway 地址使用 AES-GCM 加密保存；仅允许公网
  HTTPS 地址并拒绝内网目标，任务完成后自动投递且不影响主任务落库
- 数据资产：任务完成后把每条标准化内容写入记录中心，按用户、平台和来源 ID 跨任务去重，
  保留首次/最近任务、重复次数、原始 JSON，并支持正文、标题、作者和平台筛选
- 分布式 Worker：节点密钥注册、Bearer 身份验证、能力上报、心跳续租、按能力抢单、
  有界并发执行和完整报告回传；CLI 与 Worker 共用同一采集运行时
- 调度与远程执行：标准 5 字段 Cron、IANA 时区、DST 处理、暂停/恢复/立即运行；默认
  outbound polling，并可登记加密端点与令牌后使用 Direct HTTPS Agent 或 Reverse WebSocket Gateway
- 受控浏览器自动化：按 Profile/Worker 建立有时限会话，支持标签页、导航、可访问性快照、点击、
  输入和截图；域名 allowlist、DNS/私网阻断、动作密文、审计与 S3 截图访问控制均在服务端执行，
  不提供任意 JavaScript/eval、文件协议或凭据回显
- 团队与接口：viewer/editor/owner 服务端授权、工作区成员管理、Spring Security OIDC、请求关联 ID、
  Actuator/Prometheus 指标和 API 1.2 能力清单
- 自托管：Compose 启动 Spring Boot、React、PostgreSQL、MinIO、持久化 Worker 和非 root Chromium/noVNC；
  CDP 仅在容器内网开放，本地 Owner 使用 Basic Auth，注册密钥与凭据加密根密钥分离
- 传统执行集群：独立 Gateway 镜像、Compose 集群文件与 Helm Chart；StatefulSet 为每个 Agent
  保存独立 Worker 身份和 Chromium Profile，并提供 Secret、PDB、NetworkPolicy、探针和资源限制
- OpenCLI 动态适配：锁定并在 Worker 启动时验证 1.8.5，发现 171 个站点 / 1,257 个命令；常用站点
  自动选择搜索或发现命令，特殊站点允许显式指定只读命令和参数；浏览器命令仅在 CDP 健康时上报
- 数据接入层契约：平台与供应商拆成两个维度，获取模式区分 `searchAll` / `fetchOwned` / `streamLive`
- 取数护栏：凭据分档（Cookie 恒禁 / 应用级凭据放行）、按 host 平滑限流（≤1 QPS）、
  429/暂时性 5xx/网络故障指数退避并遵守 `Retry-After`，而 **403 快速失败**；
  错误信息自动隐藏 URL 中的 key/token/secret，避免诊断日志泄露凭据
- 字段提取：四个 provider 各自把作者、链接、ID、互动量归一到 `SourceItem`，
  平台特有字段进 `raw`
- 聚类层：从上游复用并加固（修复就地排序破坏 indices 对应关系的缺陷、
  补齐未检查的数组下标访问、ZhipuAI 响应缺字段时的报错），
  并补了 `DataCleaner.clean()` 的 `indices` 返回 —— 清洗会过滤与去重，
  没有这个映射就无法把簇成员关联回原始记录
- LLM 接入层：url/key/model 三项配置，OpenAI 兼容与 Anthropic Messages 双线路
- 七个 provider：Bluesky Jetstream（实时流，零凭据）、Bluesky 检索（需凭据，当前不可用）、
  Reddit（官方 API + OAuth）、YouTube（Data API v3，含评论），
  以及经 TikHub 接入的小红书 / 抖音 / TikTok（均含评论）
- 编排层：按模式自动选路，provider → 聚类 → LLM 有界并发归纳 → 洞察与原始数据一并落盘，
  并记录成功/跳过的簇数，避免部分结果被误当成完整结果
- 导出层：JSON 全量 + CSV 分表（帖子 / 评论 / 聚类），带 BOM 与公式注入防护
- CLI 与落盘、进程级代理支持

**已用真实网络验证**
- Jetstream 实时流：2.7 秒取到 8 条真实数据
- Bluesky 历史检索：403 已复现，确认为端点级授权要求
- Reddit / YouTube：主机可达（doctor 全 200），但**尚未用真实凭据跑通** —— 未验证

**下一步**
1. 拿真实凭据验证四条 TikHub 链路与 Reddit / YouTube（`pnpm smoke:reddit`）
2. 用自有浏览器登录态验证 Bilibili、知乎、微博、X、LinkedIn 等 OpenCLI 浏览器适配器
3. Reddit 评论抓取 —— 当前 `canFetchComments: false`，只取帖子
4. Jetstream 的 `author` 只有 DID，没有 handle；要显示名需再调
   `app.bsky.actor.getProfile` 补齐
5. `fetchOwned` 模式的 creator API provider
6. 为 `linux/amd64` / `linux/arm64` 增加真实 Docker Buildx 启动矩阵与恢复演练
7. 为 PostgreSQL/MinIO 增加自动备份、恢复演练和控制平面多副本滚动升级
8. Dify code/tool/plugin 的独立强沙箱；在沙箱完成前继续阻断任意代码执行，不以兼容名义降低安全边界

## 平台覆盖

| 平台 | 路径 | 评论 | 状态 |
|---|---|---|---|
| Bluesky | AT Protocol Jetstream | 回复 | ✅ 真实网络验证过，零凭据；只有实时增量，无历史 |
| Reddit | 官方 Data API | ❌ | ⚠️ 未用真实凭据验证。免费档仅限非商业 |
| YouTube | Data API v3 | ✅ | ⚠️ 未用真实凭据验证。search 约 100 次/天 |
| **小红书** | **Spider_XHS**（自有账号登录态） | ✅ | ⚠️ 代码完整，未用真实账号跑通 |
| 小红书 | TikHub | ✅ | ⚠️ 未用真实 key 验证 |
| 抖音 | TikHub | ✅ | ⚠️ 同上 |
| TikTok | TikHub | ✅ | ⚠️ 同上 |
| Bilibili / 知乎 / 微博 / X / LinkedIn | OpenCLI + 自有浏览器会话 | 依命令 | ⚠️ 已接入动态能力，需本机登录与连接测试 |
| Hacker News | OpenCLI 公开 API | ❌ | ✅ `search` 已真实请求验证 |
| 雪球 / 东方财富 | OpenCLI | 依命令 | ⚠️ 已接入，受地区、登录态与页面变化约束 |
| 其余 OpenCLI 站点 | 动态目录 | 依命令 | 171 个站点均可调度；自动发现失败时可指定只读命令与参数 |
| GEO 官网观测 | OpenCLI CDP Bridge + 匿名 Profile | ❌ | ✅ `official-site.observe@1.0.0`；SSRF、DNS、robots 与个性化页面拒绝 |

OpenCLI 通过外部进程接入，ThreadBeacon 不复制它的站点适配代码、Cookie 或签名实现。Bilibili 等
平台仍有显著的服务条款与法律风险；“技术能力已接入”不代表“得到平台官方授权”或“可商用”。
涉及浏览器登录态的任务必须使用运行者本人的账号并先完成连接测试。

TikHub 那四个平台的字段映射来自上游 SeekMoney-ai 跑通过的解析代码，并有离线测试
锁住结构，但**没有用真实 key 打过一次真请求** —— 拿到 key 后第一件事是核对
响应结构是否仍然一致（TikHub 的响应层级在不同端点间就不统一，见 `pickArray` 的兜底）。

微信视频号、快手、Meta / Instagram 等即使在 OpenCLI 目录中出现，也不等于存在合规商业
数据通道。详见 `docs/行业合规范式.md` §5 与 `DISCLAIMER.md` §5。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/技术选型调研.md` | 开源方案横向对比、license 准入、辖区矩阵（含两处勘误） |
| `docs/行业合规范式.md` | 合法同行怎么拿数据、可采购清单与顺序 |
| `docs/GDPR架构边界.md` | ⚠️ 历史调研。描述的是一套靠架构达成匿名化的设计，已不是当前实现 |
| `docs/二开方案.md` | 六阶段实施方案 |

## 参与贡献

见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。签名逆向、绕过访问控制、虚假账号和默认开放
写操作不会被接受；登录态外部适配必须限定为运行者自有账号，并如实记录 provenance。

安全问题请勿走公开 issue，见 [`SECURITY.md`](./SECURITY.md)。

## 许可

本项目采用 **Apache License 2.0**，全文见 [`LICENSE`](./LICENSE)。

选 Apache-2.0 而非 MIT 的理由：它有明确的专利授权（§3）、与本项目已在使用的
NOTICE 归属机制配套（§4d），以及比 MIT 更具体的免责与责任限制条款（§7、§8）——
对一个处在法律敏感领域的工具，后两点有实际意义。MIT 代码可以合法并入
Apache-2.0 项目，因此复用的上游文件不受影响。

`src/clustering/` 源自 [SeekMoney-ai](https://github.com/liangdabiao/SeekMoney-ai)，
MIT，Copyright (c) 2025 liangdabiao。完整声明见 [`NOTICE`](./NOTICE)。

上游的数据采集层（`tikhub-client.ts` 与八个平台 service）**未被采用** ——
其 README 宣称的"官方 API 接口，避免法律风险"与 TikHub 自身服务条款
（"TikHub is an unofficial API"）矛盾。理由见 `docs/技术选型调研.md` §15。

> `NOTICE` 中的版权行写的是 `threadbeacon contributors`。如果你要以个人或公司名义发布，
> 记得改成实际的版权主体。
