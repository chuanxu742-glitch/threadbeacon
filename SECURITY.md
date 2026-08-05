# 安全策略 / Security Policy

## 报告漏洞

**请勿通过公开 issue 报告安全问题。**

请通过仓库的私密漏洞报告通道（GitHub Security Advisories）提交，或联系维护者。
报告中请包含：影响范围、复现步骤、受影响的版本或 commit。

## 本项目关注的安全问题

除常规的依赖漏洞外，以下几类对本项目属于**高优先级**，因为它们会破坏
`DISCLAIMER.md` 第 1 节声明的约束：

| 类别 | 说明 |
|---|---|
| **凭据护栏绕过** | 任何能让请求携带 `Cookie` / `Authorization` 而不触发 `AuthenticatedRequestError` 的路径 |
| **标识符泄漏** | 能让 handle / userID / permalink / 精确时间戳进入持久层或日志的路径 |
| **脱敏绕过** | 能构造出未经 `buildSourceItem()` 脱敏的 `SourceItem` 的路径 |
| **k-匿名绕过** | 未显式传 `unsafeAllowSmallClusters` 却产出小于 `K_ANONYMITY_FLOOR` 的簇 |
| **日志泄漏** | 原始 payload 或未脱敏文本出现在日志、错误堆栈或异常信息中 |

前四类即使不构成传统意义上的"漏洞"，也按安全问题处理 —— 它们直接影响
运营者能否主张聚类输出已匿名化。

## 供应链

本项目的依赖审计命令见 `docs/技术选型调研.md` 第 7 节。发布前建议执行：

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
osv-scanner scan source -r . --licenses
```

采集类项目的特有风险是内嵌混淆 JS 与硬编码的第三方签名服务地址。本项目
不包含此类代码，若在依赖中发现，请按上述通道报告。

## 不属于安全问题的情形

- 目标平台改版导致 provider 失效 —— 这是维护问题，走普通 issue。
- 对某辖区法律适用性的疑问 —— 见 `DISCLAIMER.md`，本项目不提供法律意见。
