# GEO 受控采集桥接

当前实现按 `opencli-Razormind` 的真实能力边界接入：只发布
`official-site.observe@1.0.0`（输出 schema `1`），不虚构参考项目未发布的
`chat-ai.capture`。

它解决的是 GEO 系统到采集执行节点之间的官网观测链路：版本化能力、运行时
ready 探测、幂等提交、异步执行、状态查询、取消、PostgreSQL 状态、S3/MinIO 报告和审计。
它不是“自动向 ChatGPT / Claude / Gemini 提问并计算品牌可见度”的完整 GEO
评分产品；那属于后续独立能力版本。

## Worker 条件

承担 GEO 任务的 Worker 必须同时满足：

- `@jackwener/opencli` 运行时版本通过 `1.8.5` 校验；
- `OPENCLI_CDP_ENDPOINT` 健康；
- 使用独立干净浏览器 Profile，设置唯一的 `THREADBEACON_BROWSER_PROFILE` 名称，并设置
  `THREADBEACON_BROWSER_PROFILE_KIND=anonymous`；
- Worker 通过浏览器级 CDP `Storage.getCookies` 证明完整 Cookie jar 为空。证明有效期
  75 秒，由已认证心跳刷新，过期或发现 Cookie 后立即撤下 `geo` 能力。

不满足时 Worker 不会上报 `geo`，能力接口返回 `ready: false` 和
`no_clean_profile`。执行前还会校验公网 DNS、阻断私网跳转、检查
`robots.txt`；检测到登录身份、登录墙或访问挑战时任务失败关闭，不保存页面内容。

每个 GEO execution 使用独立状态机和 30 秒租约。Worker 心跳会续租；控制面发现
租约过期后使用尝试序号进行围栏并自动回队列。取消会先写入 acquisition 状态，过期
Worker 随后回传的结果会被拒绝。完整报告和版本化 Trace 保存到 S3/MinIO。

自托管环境可以直接启动隔离的 GEO 浏览器池和 Worker：

```bash
docker compose --profile geo up --build -d
```

该 Profile 使用独立浏览器卷；每次官网观测前后都会清理 Cookie 和缓存，不与常规
登录态 Worker 共用浏览器资源。

## 接口

查询能力：

```http
GET /api/v1/internal/geo-acquisition/capabilities
```

提交观测：

```http
POST /api/v1/internal/geo-acquisition/executions
Content-Type: application/json

{
  "request_id": "geo-request-001",
  "idempotency_key": "brand-home-2026-08-28",
  "capability": {
    "id": "official-site.observe",
    "version": "1.0.0"
  },
  "output_schema_version": "1",
  "input": {
    "url": "https://example.com/"
  },
  "environment": {},
  "required_artifacts": ["trace"],
  "geo_refs": {
    "brand_id": "brand-001"
  }
}
```

首次提交返回 `202`；相同用户、相同幂等键和相同请求返回既有执行（`200`）；
同一幂等键对应不同请求返回 `409 idempotency_conflict`。

```http
GET  /api/v1/internal/geo-acquisition/executions/{execution_id}
POST /api/v1/internal/geo-acquisition/executions/{execution_id}/cancel
```

管理台也可以直接选择“GEO 官网观测”，输入公开官网 URL 创建普通任务。
