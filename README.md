# caiji

多平台社媒数据采集与聚合分析。采集**公开**内容 → 语义聚类 → LLM 提炼痛点 →
连同原始数据一起导出。

License: Apache-2.0 · Node ≥ 22 · TypeScript strict

> ⚠️ **部署前请先读 [`DISCLAIMER.md`](./DISCLAIMER.md)。**
> 本项目不做登录态采集、不含任何签名逆向代码；但它**完整保留原文、作者、
> 原帖链接与精确时间戳**，落盘产物属个人数据。开源发布不构成"在你的辖区使用它
> 是合法的"这一主张，GDPR / 个保法 / 平台 ToS 的义务归**运行它的人**。

## 凭据边界

1. **caiji 自己发出的请求不带用户会话凭据。** `PoliteHttpClient` 在任何
   `AuthMode` 下都拒发 `Cookie`，命中即抛错，只能改源码绕过。
   依据：Meta v. Bright Data（登出抓公开数据）胜诉，Meta v. Voyager Labs
   （登录态 + 假账号）被判永久禁令。
   > `app-credential` 指平台签发给应用的凭据（Reddit OAuth、YouTube API key），
   > 官方 API 是最合规的取数路径，与登录态采集性质完全不同。
2. **无签名逆向。** 本项目不含 `x-s` / `a_bogus` / `x5sec` 及同类实现。
   直接原因是「丁某案」——破解抖音 X-Gorgon 被认定为"专门用于侵入计算机信息系统
   的程序"，判缓刑（见 `docs/技术选型调研.md`）。
3. ⚠️ **例外：小红书 provider 使用登录态。** 它以子进程调用你自行安装的
   Spider_XHS，用你**自有账号**的登录会话取数。仅在配置了 `SPIDER_XHS_PATH`
   时启用，默认关闭；provenance 会如实记为 `user-authorized` / `user-session`。
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
    xiaohongshu/
      spider-xhs.ts      经 Spider_XHS 子进程取数（自有账号登录态）
    tikhub/            第三方聚合供应商，一个 token 三个平台
      client.ts          Bearer 认证 + 响应外壳兜底
      base.ts            分页/评论/打包骨架，子类只填端点与字段映射
      xiaohongshu.ts douyin.ts tiktok.ts
  llm/               LLM 接入层，OpenAI 兼容 / Anthropic Messages 双线路
  clustering/        语义聚类（源自 SeekMoney-ai，MIT，见 NOTICE）
  pipeline/
    analyze.ts         端到端编排
    report.ts          产物类型
    export.ts          CSV 分表与 JSON 全量
    store.ts           落盘
tests/
scripts/             真实凭据的冒烟脚本
docs/                调研与设计文档
reference/           上游只读参考，不入版本库
```

## 命令行

```bash
pnpm doctor                                # 检查数据源可达性与凭据配置
pnpm cli analyze bluesky "battery life" 50 # 跑一次分析并落盘
pnpm cli list                              # 列出已有报告
pnpm cli export <目录>                      # 重新导出已有报告
pnpm xhs:login                             # 小红书扫码登录（仅用 Spider_XHS 时需要）
```

### 启用小红书

Spider_XHS 无 LICENSE 文件，代码不随本项目分发，需自行安装：

```bash
git clone https://github.com/cv-cat/Spider_XHS
cd Spider_XHS && pip install -r requirements.txt && npm install

# 回到 caiji，在 .env.local 里写：
#   SPIDER_XHS_PATH=/abs/path/to/Spider_XHS
pnpm xhs:login                              # 扫码，cookie 存本地
pnpm cli analyze xiaohongshu "粉底液" 50
```

需要 Python 3.10+ 与 Node.js 20+（Spider_XHS 的要求）。
caiji 通过 `scripts/spider_xhs_bridge.py`（本仓库原创）以子进程调用它，
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

或用 `llmConfigFromEnv()` 读 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，见 `.env.example`。

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
pnpm typecheck
pnpm test
```

需要 Node ≥ 22。无 Docker 依赖。

重建上游参考仓库：

```bash
git clone https://github.com/liangdabiao/SeekMoney-ai reference/SeekMoney-ai
```

## 当前进度

**已完成**
- 项目骨架：TypeScript strict + `noUncheckedIndexedAccess`、vitest、106 个测试全绿
- 数据接入层契约：平台与供应商拆成两个维度，获取模式区分 `searchAll` / `fetchOwned` / `streamLive`
- 取数护栏：凭据分档（Cookie 恒禁 / 应用级凭据放行）、按 host 平滑限流（≤1 QPS）、
  429/503 退避重试而 **403 快速失败**（二者语义不同，混在一起会误诊）
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
- 编排层：按模式自动选路，provider → 聚类 → LLM 归纳 → 洞察与原始数据一并落盘
- 导出层：JSON 全量 + CSV 分表（帖子 / 评论 / 聚类），带 BOM 与公式注入防护
- CLI 与落盘、进程级代理支持

**已用真实网络验证**
- Jetstream 实时流：2.7 秒取到 8 条真实数据
- Bluesky 历史检索：403 已复现，确认为端点级授权要求
- Reddit / YouTube：主机可达（doctor 全 200），但**尚未用真实凭据跑通** —— 未验证

**下一步**
1. 拿真实凭据验证四条 TikHub 链路与 Reddit / YouTube（`pnpm smoke:reddit`）
2. 微博 —— TikHub 不提供，需另找供应商或自建路径
3. Reddit 评论抓取 —— 当前 `canFetchComments: false`，只取帖子
4. Jetstream 的 `author` 只有 DID，没有 handle；要显示名需再调
   `app.bsky.actor.getProfile` 补齐
5. `fetchOwned` 模式的 creator API provider
6. 调度（APScheduler 或任务计划触发，暂不引入独立调度器）

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
| ~~B站~~ | — | — | ⛔ **刻意排除**，见下 |

**B站为什么被排除**：2026-01-28，B站委托律所向 `SocialSisterYi/bilibili-API-collect`
（20k star，纯 API 文档、不含爬虫代码）发出律师函，指控其"系统性收集整理 B 站非公开 API
接口、调用逻辑、参数结构、访问控制与鉴权机制，并通过技术文档和代码示例向不特定公众传播"，
仓库于 2026-01-30 归档。一个只写文档的项目尚且被点名，采集实现的风险不言自明。
`Platform` 类型里已无 `bilibili`，要加回来请先确认该风险已消除。
详见 `docs/技术选型调研.md` §1。

TikHub 那四个平台的字段映射来自上游 SeekMoney-ai 跑通过的解析代码，并有离线测试
锁住结构，但**没有用真实 key 打过一次真请求** —— 拿到 key 后第一件事是核对
响应结构是否仍然一致（TikHub 的响应层级在不同端点间就不统一，见 `pickArray` 的兜底）。

仍无合规通道的：微信视频号、快手（全站搜索）、Meta / Instagram 全网公开内容。
微博 TikHub 未提供，需另找路径。详见 `docs/行业合规范式.md` §5 与 `DISCLAIMER.md` §5。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/技术选型调研.md` | 开源方案横向对比、license 准入、辖区矩阵（含两处勘误） |
| `docs/行业合规范式.md` | 合法同行怎么拿数据、可采购清单与顺序 |
| `docs/GDPR架构边界.md` | ⚠️ 历史调研。描述的是一套靠架构达成匿名化的设计，已不是当前实现 |
| `docs/二开方案.md` | 六阶段实施方案 |

## 参与贡献

见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。有两类改动不会被接受：登录态采集、
签名逆向 —— 它们是这个项目的存在前提。

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

> `NOTICE` 中的版权行写的是 `caiji contributors`。如果你要以个人或公司名义发布，
> 记得改成实际的版权主体。
