# caiji

多平台社媒数据采集与聚合分析。采集**公开**内容 → PII 脱敏 → 语义聚类 → 提炼聚合洞察。

License: Apache-2.0 · Node ≥ 22 · TypeScript strict

设计目标是让**持久化产物**达到匿名化标准，从而摆脱数据保留、DSAR 响应与跨境传输
三块运营负担；采集端的合规义务仍然存在，且落在部署者身上。

> ⚠️ **部署前请先读 [`DISCLAIMER.md`](./DISCLAIMER.md)。**
> 本项目不做登录态采集、不含任何签名逆向代码。开源发布不构成"在你的辖区使用它是
> 合法的"这一主张，GDPR / 个保法 / 平台 ToS 的义务归**运行它的人**。

## 三条不可协商的规则

这三条已经编码进类型系统与运行时，不是文档约定：

1. **不做登录态采集。** `PoliteHttpClient` 拒绝任何带 `Cookie` / `Authorization` 的请求，
   `Provenance.authenticated` 是字面量 `false` 类型。
   依据：Meta v. Bright Data（登出抓公开数据）胜诉，Meta v. Voyager Labs（登录态 + 假账号）被判永久禁令。
2. **标识符在 ingest 阶段丢弃。** `SourceItem` 类型里没有 handle / userID / permalink /
   精确时间戳 / 坐标的位置，`buildSourceItem()` 是唯一构造入口且强制脱敏。
   脱敏用**占位符替换**，不用 hash —— hash 属假名化，仍是个人数据。
3. **簇规模低于 10 不成簇。** `K_ANONYMITY_FLOOR = 10`，低于此值 `cluster()` 抛错。
   小簇会击穿 EDPB 匿名化三重测试里的 No Inference。

完整依据见 `docs/GDPR架构边界.md`。

## 目录

```
src/
  providers/     数据接入层
    types.ts       Platform × ProviderKind 二维契约、TextBundle、Provenance
    registry.ts    按 (platform, kind) 索引，按合规优先级 resolve
    http.ts        限流 + 凭据拦截的 HTTP 客户端
  privacy/
    minimize.ts    PII 脱敏与数据最小化，SourceItem 的唯一构造入口
  llm/           LLM 接入层，OpenAI 兼容 / Anthropic Messages 双线路
  clustering/      语义聚类（源自 SeekMoney-ai，MIT，见 NOTICE）
tests/
docs/            调研与设计文档
reference/       上游只读参考，不入版本库
```

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

**为什么是两条线路而不是一个 OpenAI 兼容层**：两边语义实质不同——Anthropic 的 `system`
是顶层参数不是消息、`max_tokens` 必填、响应 `content` 是内容块数组、拒答走
HTTP 200 + `stop_reason='refusal'`、当前模型发送 `temperature` 会 400。
套 OpenAI 壳会把这些全丢掉，所以两条链路各用各的官方 SDK，只在 `ILlmClient` 这层统一。

线路格式省略时按 model 前缀与 baseUrl 主机名推断（`claude-*` 或主机名含 `anthropic` 判为
Anthropic，其余归 OpenAI）；接第三方网关建议显式写 `format`。
`thinking` 仅 Anthropic 线路有效，走官方端点默认 `adaptive`，指定自定义 `baseUrl` 时默认关闭——
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
- 项目骨架：TypeScript strict + `noUncheckedIndexedAccess`、vitest、55 个测试全绿
- 数据接入层契约：平台与供应商拆成两个维度，获取模式区分 `searchAll` / `fetchOwned`
- 合规护栏：凭据拦截、按 host 平滑限流（≤1 QPS）、429/403 熔断
- 隐私最小化层：结构化 PII 正则脱敏 + 可插拔 NER 接口、时间降采样、地理粒度校验
- 聚类层：从上游复用并加固（k-匿名下限、修复就地排序破坏 indices 对应关系的缺陷、
  补齐未检查的数组下标访问、ZhipuAI 响应缺字段时的报错）
- LLM 接入层：url/key/model 三项配置，OpenAI 兼容与 Anthropic Messages 双线路，
  各用官方 SDK，端口可注入因而全流程可离线测试

**下一步**
1. `BlueskyProvider` —— AT Protocol firehose，开放免费，无授权门槛，最适合先跑通闭环
2. `RedditProvider` —— 官方 API，注意免费档仅限非商用，商用需签约
3. `YouTubeProvider` —— Data API v3，注意 `search.list` 自 2026-06-01 起独立配额约 100 次/天
4. 编排层：provider → 脱敏 → 聚类 → 分析 → 只持久化聚类级输出
5. 接 Presidio 本地部署补齐姓名/地名等无固定结构的 PII

**平台可行性**：小红书、B站、快手、微信视频号无合规内容 API；
Meta/Instagram 无商业数据许可通道；TikTok 需先过 Marketing Partner 审核。
详见 `docs/行业合规范式.md` §5。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/技术选型调研.md` | 开源方案横向对比、license 准入、辖区矩阵（含两处勘误） |
| `docs/行业合规范式.md` | 合法同行怎么拿数据、可采购清单与顺序 |
| `docs/GDPR架构边界.md` | 可落到代码的 GDPR 结论 |
| `docs/二开方案.md` | 六阶段实施方案 |

## 参与贡献

见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。有三类改动不会被接受：登录态采集、
签名逆向、降低隐私默认值——它们是这个项目的存在前提。

安全问题请勿走公开 issue，见 [`SECURITY.md`](./SECURITY.md)。

## 许可

本项目采用 **Apache License 2.0**，全文见 [`LICENSE`](./LICENSE)。

选 Apache-2.0 而非 MIT 的理由：它有明确的专利授权（§3）、与本项目已在使用的
NOTICE 归属机制配套（§4d），以及比 MIT 更具体的免责与责任限制条款（§7、§8）——
对一个处在法律敏感领域的工具，后两点有实际意义。MIT 代码可以合法并入
Apache-2.0 项目，因此复用的上游文件不受影响。

`src/clustering/` 源自 [SeekMoney-ai](https://github.com/liangdabiao/SeekMoney-ai)，
MIT，Copyright (c) 2025 liangdabiao。完整声明见 [`NOTICE`](./NOTICE)。

上游的数据采集层（`tikhub-client.ts` 与八个平台 service）**未被采用**——
其 README 宣称的"官方 API 接口，避免法律风险"与 TikHub 自身服务条款
（"TikHub is an unofficial API"）矛盾。理由见 `docs/技术选型调研.md` §15。

> `NOTICE` 中的版权行写的是 `caiji contributors`。如果你要以个人或公司名义发布，
> 记得改成实际的版权主体。
