# 免责声明与使用边界 / Disclaimer and Scope

> **English summary:** This project collects **publicly visible** social data only.
> It cannot perform authenticated scraping and contains no signature-reversing
> code — these are enforced by the type system and runtime. It **does** retain
> raw content and identifiers (author, permalink, timestamps) and exports them.
> Publishing this code is **not** a claim that operating it is lawful in your
> jurisdiction. Compliance obligations (GDPR Art. 6/14/27, PIPL, platform Terms
> of Service) attach to **whoever runs it**, not to the code. Read the sections
> below before deploying.

---

## 1. 本项目在代码层面**不能**做什么

以下两条不是使用建议，是编码进类型系统与运行时的约束。绕过它们需要改代码，
而不是改配置：

| 约束 | 实现位置 | 绕过方式 |
|---|---|---|
| **不做登录态采集** | `PoliteHttpClient` 检测到 `Cookie` 头即抛 `SessionCredentialError`；`AuthMode` 只有 `anonymous` 与 `app-credential` 两个取值，用户身份在类型层面不可表达 | 只能改源码 |
| **无签名逆向** | 代码库中不包含 `x-s`、`a_bogus`、`x5sec` 及同类实现，也不引入执行混淆 JS 的运行时 | 只能改源码 |

依据：Meta v. Bright Data（登出抓公开数据）胜诉，Meta v. Voyager Labs
（登录态 + 假账号）被判永久禁令。二者的分界就是有无用户会话凭据。

> 注意 `app-credential` 指平台签发给应用的凭据（Reddit OAuth、YouTube API key），
> 官方 API 是**最合规**的取数路径，与登录态采集性质完全不同。

## 2. 本项目**会**保留什么 —— 以及由此产生的义务

这一节比上一节更需要读。本项目**完整保留采集到的原始数据**并提供导出：

| 保留项 | 说明 |
|---|---|
| 原文 | 帖子与评论正文，不改写、不脱敏 |
| 作者标识 | 显示名 / handle、平台内稳定 ID（如 Reddit `t2_xxx`、Bluesky DID） |
| 原帖链接 | permalink，可直接回溯到原帖 |
| 精确时间戳 | 发布时刻，保留原始精度 |
| 互动量 | 点赞、评论、转发、播放数 |
| 平台原始字段 | `SourceItem.raw`，各平台特有字段原样留存 |

**这意味着落盘产物是个人数据，而非匿名数据。** 因此下列义务**完整适用**，
不存在因匿名化而豁免的部分：

- 数据保留期限与到期删除机制
- 数据主体请求（DSAR）的响应通道：访问、更正、删除、反对
- 跨境传输的合法性基础（SCC、充分性认定或等效机制）
- 记录处理活动（GDPR Art. 30）

`analysis-results/` 下的目录含原文、作者与链接，应按个人数据对待：
限制访问权限、纳入备份与删除策略、不要提交进版本库
（`.gitignore` 已排除，请勿覆盖该规则）。

## 3. 合规义务归运营者，不归代码

开源发布的是代码。**运行它才产生数据处理行为**，因而下列义务落在部署者身上：

- **GDPR**：若采集对象包含欧盟居民的个人数据，需要 Art. 6(1)(f) 正当利益基础
  与书面 LIA、Art. 14 告知（或其例外的适用论证）、Art. 27 欧盟代表、
  公开隐私声明与数据主体权利响应通道。
- **中国个人信息保护法**：第 3 条有域外效力；第 53 条对境外主体要求境内代表。
- **平台服务条款**：遵守 robots.txt 与 ToS 是部署者的责任。本项目提供限流与
  robots 检查的位置，但不能代替你去读目标平台的条款。

> `docs/GDPR架构边界.md` 描述的是一套「靠架构达成匿名化从而收窄义务」的设计。
> 那套设计**已不再是本项目的实现**（见上节），该文档现作为历史调研保留。

## 4. 本项目**不做**的宣称

- 不宣称在任何辖区使用本项目是合法的。
- 不宣称任何被接入的数据来源"经过平台官方授权"。各 provider 的授权依据由
  `ProviderCapability.legalBasis` 字段声明，其真实性由**接入方**负责。
- 不宣称使用本项目可以"规避法律风险"。

> 最后一条是有针对性的。调研中发现的同类项目在 README 中宣称
> "官方 API 接口，避免法律风险"，而其数据供应商的服务条款白纸黑字写着
> "unofficial API"。这类不实陈述在对外交付时可能构成对客户的虚假陈述，
> 风险高于技术问题本身。详见 `docs/技术选型调研.md` 第 15 节。

## 5. 已知不支持的平台

以下平台经调研确认**没有可用的合规内容接口**，本项目不提供、也不接受相关
逆向实现（详见 `docs/行业合规范式.md` 第 5 节）：

小红书、微信视频号、B 站、快手（全站搜索）；Meta / Instagram 全网公开内容；
TikTok（需先取得 Marketing Partner 资格）。

若你的场景需要这些数据，合规路径是官方付费数据产品、用户授权的自有账号数据，
或有实体、可签合同的持牌第三方数据供应商。

## 6. 无担保

本项目按 Apache License 2.0 分发，依该许可证第 7 条**不提供任何形式的担保**，
第 8 条限制贡献者的责任。使用前请自行进行法律与合规评估；
本文件是工程说明，不构成法律意见。
