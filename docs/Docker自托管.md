# Docker 自托管

`compose.yaml` 会启动六个真实服务：

- Web：Nginx 托管的 React/Vite 静态管理台；
- 控制平面：Java 17 / Spring Boot API；
- PostgreSQL：任务、工作流、租约、审计与记录；
- MinIO：报告、截图和 GEO Trace；
- Worker：能力发现、抢单、心跳、采集与工作流执行；
- Browser：持久化 Chromium、CDP `9222` 和 noVNC `6080`。

镜像只使用 Debian/Node 的多架构基础镜像与发行版软件包，可在 Docker 支持的
`linux/amd64` 和 `linux/arm64` 主机上按本机架构构建。

## 启动

先安装 Docker Engine / Docker Desktop 与 Docker Compose v2.24+。在项目根目录创建
不会入库的 `.env`，三个值必须彼此不同：

```dotenv
THREADBEACON_LOCAL_AUTH_USERNAME=threadbeacon
THREADBEACON_LOCAL_AUTH_PASSWORD=请替换为至少16字符的随机密码
THREADBEACON_NODE_REGISTRATION_KEY=请替换为至少32字节随机值
THREADBEACON_ENCRYPTION_KEY=请替换为另一份至少32字节随机值
POSTGRES_PASSWORD=请替换为数据库随机密码
THREADBEACON_S3_SECRET_KEY=请替换为对象存储随机密码
THREADBEACON_LOCAL_AUTH_EMAIL=owner@example.com
THREADBEACON_LOCAL_AUTH_FULL_NAME=Local Owner
```

可用 `openssl rand -hex 32` 生成随机值。配置不完整时 Compose 会直接拒绝启动，项目
不提供可被误用的默认密码或注册密钥。然后执行：

```bash
docker compose up --build -d
docker compose ps
```

默认入口：

- 管理台：<http://127.0.0.1:3000>
- 浏览器桌面：<http://127.0.0.1:6080/vnc.html>

打开管理台后会进入 ThreadBeacon 登录页，输入 `.env` 中的本地用户名和密码；若部署方配置了
OIDC，也可使用企业身份入口。浏览器不会再显示原生 Basic Auth 弹窗。CDP
`9222` 只暴露给 Compose 内部网络中的 Worker，不发布到宿主机。

PostgreSQL、MinIO、浏览器登录态和 Worker 注册身份分别保存在 Docker volume，容器重建不会
丢失。首次注册后 Worker 会把节点 ID 和令牌写到 `/data/worker-state.json`，后续重启
不再创建重复节点。

## 配置

Compose 会把可选的 `.env.worker` 只注入 Worker。可把 Reddit、YouTube、TikHub、LLM
或通用 REST 来源明确需要的环境变量放在其中，避免把控制面配置整体交给执行节点：

```dotenv
# .env.worker
YOUTUBE_API_KEY=...
TIKHUB_API_KEY=...
OPENAI_API_KEY=...
```

常用端口和资源设置：

```dotenv
THREADBEACON_CONTROL_PORT=3000
THREADBEACON_NOVNC_PORT=6080
THREADBEACON_WORKER_CONCURRENCY=2
THREADBEACON_BROWSER_GEOMETRY=1440x900x24
THREADBEACON_CONTROL_MEMORY=1g
THREADBEACON_BROWSER_MEMORY=2g
THREADBEACON_WORKER_MEMORY=2g
```

## 安全边界

管理台与 noVNC 使用独立的回环绑定变量；CDP 不发布宿主端口。控制面本地 Owner 必须
通过 Basic Auth。noVNC 自身没有公网认证层；不要
把 `THREADBEACON_NOVNC_BIND_ADDRESS` 改为 `0.0.0.0`。远程使用时应放到带 TLS、身份认证和访问
控制的反向代理或私有网络后面。

浏览器 Profile 的 noVNC 地址只允许在管理界面中安全打开 HTTPS URL；CDP 凭据不会被
界面回显。采集账号登录态只保存在 `browser-profile` volume，不会上传到控制平面。

## 运维

```bash
docker compose logs -f web control-api postgres minio worker browser
docker compose restart worker
docker compose down
```

`docker compose down` 保留数据卷；只有显式增加 `--volumes` 才会删除本地数据库、报告、
Worker 身份和浏览器登录态。升级代码后重新执行 `docker compose up --build -d`；控制面
启动时由 Flyway 按版本执行数据库迁移。

正式升级前应备份 `postgres-data`、`minio-data`、`worker-state` 与 `browser-profile`
volume，并在副本上完成恢复验证。PostgreSQL 和 MinIO 已允许控制平面横向扩展；生产环境仍需
配置数据库高可用、对象存储冗余、备份、监控和滚动升级策略。
