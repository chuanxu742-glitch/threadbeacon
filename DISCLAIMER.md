# 免责声明与使用边界 / Disclaimer and Scope

> **English summary:** This project collects **publicly visible** social data only.
> It cannot perform authenticated scraping, cannot bypass signature or anti-bot
> measures, and refuses to persist identifiers — these are enforced by the type
> system and runtime, not by convention. Publishing this code is **not** a claim
> that operating it is lawful in your jurisdiction. Compliance obligations
> (GDPR Art. 6/14/27, PIPL, platform Terms of Service) attach to **whoever runs
> it**, not to the code. Read the sections below before deploying.

---

## 1. 本项目在代码层面**不能**做什么

以下三条不是使用建议，是编码进类型系统与运行时的约束。绕过它们需要改代码，
而不是改配置：

| 约束 | 实现位置 | 绕过方式 |
|---|---|---|
| **不做登录态采集** | `PoliteHttpClient` 检测到 `Cookie` / `Authorization` 头即抛 `AuthenticatedRequestError`；`Provenance.authenticated` 是字面量 `false` 类型 | 只能改源码 |
| **不保留标识符** | `SourceItem` 类型中不存在 handle / userID / permalink / 精确时间戳 / 坐标字段；`buildSourceItem()` 是唯一构造入口且强制脱敏 | 只能改源码 |
| **簇规模低于 10 不成簇** | `K_ANONYMITY_FLOOR = 10`，低于此值 `cluster()` 抛 `RangeError` | 需显式传 `unsafeAllowSmallClusters` |

此外，本项目**不包含也不接受**任何签名逆向代码（`x-s`、`a_bogus`、`x5sec`
及同类）。相关静态检查应作为 CI 阻断项。

## 2. 合规义务归运营者，不归代码

开源发布的是代码。**运行它才产生数据处理行为**，因而下列义务落在部署者身上：

- **GDPR**：若采集对象包含欧盟居民的个人数据，需要 Art. 6(1)(f) 正当利益基础
  与书面 LIA、Art. 14 告知（或其例外的适用论证）、Art. 27 欧盟代表、
  公开隐私声明与数据主体权利响应通道。
- **中国个人信息保护法**：第 3 条有域外效力；第 53 条对境外主体要求境内代表。
- **平台服务条款**：遵守 robots.txt 与 ToS 是部署者的责任。本项目提供限流与
  robots 检查的位置，但不能代替你去读目标平台的条款。

技术设计能降低义务范围（见 `docs/GDPR架构边界.md`），但不能消灭义务。

## 3. 本项目**不做**的宣称

- 不宣称在任何辖区使用本项目是合法的。
- 不宣称任何被接入的数据来源"经过平台官方授权"。各 provider 的授权依据由
  `ProviderCapability.legalBasis` 字段声明，其真实性由**接入方**负责。
- 不宣称使用本项目可以"规避法律风险"。

> 最后一条是有针对性的。调研中发现的同类项目在 README 中宣称
> "官方 API 接口，避免法律风险"，而其数据供应商的服务条款白纸黑字写着
> "unofficial API"。这类不实陈述在对外交付时可能构成对客户的虚假陈述，
> 风险高于技术问题本身。详见 `docs/技术选型调研.md` 第 15 节。

## 4. 已知不支持的平台

以下平台经调研确认**没有可用的合规内容接口**，本项目不提供、也不接受相关
逆向实现（详见 `docs/行业合规范式.md` 第 5 节）：

小红书、微信视频号、B 站、快手（全站搜索）；Meta / Instagram 全网公开内容；
TikTok（需先取得 Marketing Partner 资格）。

若你的场景需要这些数据，合规路径是官方付费数据产品、用户授权的自有账号数据，
或有实体、可签合同的持牌第三方数据供应商。

## 5. 无担保

本项目按 Apache License 2.0 分发，依该许可证第 7 条**不提供任何形式的担保**，
第 8 条限制贡献者的责任。使用前请自行进行法律与合规评估；
本文件是工程说明，不构成法律意见。
