# 贡献指南

## 提交前

```bash
pnpm install
pnpm typecheck   # 必须零报错
pnpm test        # 必须全绿
```

TypeScript 开了 `strict` 与 `noUncheckedIndexedAccess`。不要为了让编译通过而放宽
tsconfig —— 如果类型报错，通常说明代码里确实存在未检查的下标访问或空值路径。

## 两条不接受的改动

这些是项目的存在前提，PR 触及即会被拒（理由见 `DISCLAIMER.md` 第 1 节）：

1. **放宽 `PoliteHttpClient` 的凭据校验。** 它在任何 `AuthMode` 下都拒发
   `Cookie`，这条不设开关。新增绕过该校验的 HTTP 路径、在 provider 里自建
   fetch 同样不接受。
   > 需要登录态的数据源走外部工具路径（见 `providers/external.ts` 与
   > `providers/xiaohongshu/spider-xhs.ts`）：由使用者自行安装第三方工具，
   > caiji 以子进程调用，并在 provenance 里如实标记 `auth='user-session'`。
   > 关键是**如实记录**——把登录态采来的数据标成 `anonymous` 才是真正不可接受的。
   > 应用级凭据（Reddit OAuth、YouTube API key）不在此列，用 `app-credential`。
2. **在本仓库内实现签名逆向。** `x-s` / `a_bogus` / `x5sec` 及同类，
   以及为执行混淆 JS 而引入的运行时。
   直接原因是「丁某案」的刑事判例，见 `DISCLAIMER.md` §1。

## 引入第三方采集工具

若某数据源只能靠外部工具取到，走「外部依赖」模式，不要把它的代码复制进来：

- 在 `scripts/` 下写一个桥接脚本（本仓库原创），以 JSON 与之交换数据
- provider 用 `ExternalToolPort` 声明真实的 `authMode`
- 该工具由使用者自行安装，用环境变量指向；`.env.example` 里写清 license 与限制
- **先读它的 LICENSE 原文**：无 LICENSE 文件 = 全版权保留 = 代码不可复制、
  不可分发，只能这样外部调用

## 关于原始数据

本项目保留并导出原文、作者、链接与精确时间戳（见 `DISCLAIMER.md` 第 2 节）。
新增 provider 时，**尽量把平台返回的字段提取完整** —— 归一到 `SourceItem`
的具名字段，平台特有的放进 `raw`。丢字段比多留字段更难事后补救：
重新采集要重新烧配额，而原帖可能已经删了。

对应地，落盘产物是个人数据。不要把 `analysis-results/` 提交进版本库，
不要在 issue 或 PR 里粘贴含真实作者名与链接的样本。

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
`DISCLAIMER.md` 第 1 节的两条约束相容。
