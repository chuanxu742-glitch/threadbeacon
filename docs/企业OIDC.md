# 企业 OIDC

Java 自托管控制面通过 Spring Security OAuth2 Client 支持标准 OpenID Connect Authorization Code
Flow。服务端从 issuer Discovery/JWKS 校验 ID Token，并使用服务端 HTTP Session 保存认证状态。

最小配置：

```dotenv
SPRING_SECURITY_OAUTH2_CLIENT_PROVIDER_THREADBEACON_ISSUER_URI=https://id.example.com
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_THREADBEACON_PROVIDER=threadbeacon
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_THREADBEACON_CLIENT_ID=threadbeacon
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_THREADBEACON_CLIENT_SECRET=...
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_THREADBEACON_SCOPE=openid,profile,email
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_THREADBEACON_AUTHORIZATION_GRANT_TYPE=authorization_code
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_THREADBEACON_REDIRECT_URI={baseUrl}/login/oauth2/code/{registrationId}
```

将真实外部地址对应的 `/login/oauth2/code/threadbeacon` 登记为回调 URI；登录入口是
`/oauth2/authorization/threadbeacon`。确认企业登录可用后设置 `THREADBEACON_ALLOW_LOCAL_AUTH=false`。

## 目录限制与 RBAC

账号主键由 `issuer + subject` 的 SHA-256 派生，不会仅按邮箱合并不同身份提供商的账号。首次登录以
viewer 身份进入；个人工作区建立后成为该工作区 owner，团队工作区角色由 `workspace_members` 的
owner/editor/viewer 分配决定。成员使用邀请链接中的 token 调用 `/api/access/invitations/accept` 接受邀请，
再在请求中发送 `X-Workspace-Id` 选择团队工作区；`/api/access/workspaces` 可列出可选工作区。当前版本
不自动把 IdP group claim 映射成 owner，避免目录组误配置造成提权。

生产环境必须使用 HTTPS、安全 Session Cookie 和可信反向代理头。Client secret、节点注册密钥和数据
加密根密钥必须分别生成；不要把 OIDC Client secret 写入仓库或前端环境变量。
