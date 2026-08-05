# 贡献指南

## 提交前

```bash
pnpm install
pnpm typecheck   # 必须零报错
pnpm test        # 必须全绿
```

TypeScript 开了 `strict` 与 `noUncheckedIndexedAccess`。不要为了让编译通过而放宽
tsconfig —— 如果类型报错，通常说明代码里确实存在未检查的下标访问或空值路径。

## 三条不接受的改动

这些是项目的存在前提，PR 触及即会被拒（理由见 `DISCLAIMER.md`）：

1. **任何形式的登录态采集。** 包括但不限于：放宽 `PoliteHttpClient` 的凭据校验、
   新增绕过该校验的 HTTP 路径、在 provider 中自建 fetch。
2. **任何签名逆向或反爬对抗代码。** `x-s` / `a_bogus` / `x5sec` 及同类，
   以及为执行混淆 JS 而引入的运行时。
3. **降低隐私默认值。** 包括：给 `SourceItem` 加标识符字段、
   把 `K_ANONYMITY_FLOOR` 调低、让 `buildSourceItem()` 之外的路径能构造 SourceItem、
   把原文评论写进持久层。

## 新增 provider

实现 `IDataProvider`，并在 `ProviderCapability` 中如实填写：

- `kind`：`open-protocol` / `official-api` / `licensed-vendor` / `user-authorized`
- `legalBasis`：该数据源的授权依据，人类可读。这句话会写进每一条数据的
  `provenance`，是审计材料的一部分 —— **不要写你无法举证的内容**。
- `modes`：只声明真正实现了的获取模式。`searchAll` 意味着能按关键词搜全站；
  多数 creator API 做不到这件事，应只声明 `fetchOwned`。

新 provider 需要附带使用注入端口的离线测试，参考 `tests/providers.test.ts`。

## 复用第三方代码

- 先读 LICENSE 原文，不要只看 GitHub 侧栏标签。`NOASSERTION` 可能是真限制，
  也可能是格式误报，两者都出现在本项目的调研里。
- 无 LICENSE 文件的仓库视为全版权保留，不可复用。
- 复用的文件需加溯源头注释（来源 URL、许可证、本地改动），并更新根目录 `NOTICE`。

准入判定流程见 `docs/技术选型调研.md` 第 6 节。

## 提交信息

说明改了什么以及为什么。涉及合规约束的改动，请在描述中说明它如何与
`DISCLAIMER.md` 第 1 节的三条约束相容。
