'use client';

import { type FormEvent } from 'react';
import {
  formatDate,
  safeJson,
  type ApiToken,
  type Plugin,
  type Project,
  type ProjectSource,
  type WebhookTrigger,
  type Workflow,
} from './types.js';

export function PluginsView({
  plugins,
  projects,
  projectSources,
  projectWorkflows,
  selectedProject,
  webhooks,
  webhookToken,
  apiTokens,
  plainToken,
  copied,
  busy,
  onSelectProject,
  onImportDify,
  onCreateWebhook,
  onToggleWebhook,
  onCreateToken,
  onRevokeToken,
  onCopyText,
}: {
  plugins: Plugin[];
  projects: Project[];
  projectSources: ProjectSource[];
  projectWorkflows: Workflow[];
  selectedProject: string;
  webhooks: WebhookTrigger[];
  webhookToken: string;
  apiTokens: ApiToken[];
  plainToken: string;
  copied: string;
  busy: boolean;
  onSelectProject: (id: string) => void;
  onImportDify: (event: FormEvent<HTMLFormElement>) => void;
  onCreateWebhook: (event: FormEvent<HTMLFormElement>) => void;
  onToggleWebhook: (trigger: WebhookTrigger) => void;
  onCreateToken: (event: FormEvent<HTMLFormElement>) => void;
  onRevokeToken: (id: string) => void;
  onCopyText: (key: string, value: string) => void;
}) {
  return (
    <div className="product-page integrations-page">
      <div className="section-title page-title">
        <div>
          <h3>能力与插件中心</h3>
          <p>已接入能力可直接配置、调用和追踪，不再停留在能力占位</p>
        </div>
        <span>{plugins.filter((item) => item.status === 'installed').length} ready</span>
      </div>

      <div className="plugin-grid">
        {plugins.map((item) => {
          const caps = safeJson<string[]>(item.capabilities_json, []);
          const implemented = item.status === 'installed';
          return (
            <article key={item.id} className={item.status}>
              <header>
                <span>
                  {item.kind === 'source'
                    ? '◎'
                    : item.kind === 'runtime'
                    ? '⌘'
                    : item.kind === 'delivery'
                    ? '↗'
                    : '◆'}
                </span>
                <b>{implemented ? '已接入' : '未启用'}</b>
              </header>
              <h3>{item.name}</h3>
              <p>
                {item.plugin_key} · v{item.version}
              </p>
              <div>
                {caps.map((cap) => (
                  <code key={cap}>{cap}</code>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div className="integration-grid">
        <section className="integration-card">
          <header>
            <span>DI</span>
            <div>
              <h3>导入 Dify 流程</h3>
              <p>把 Dify YAML 转换为可编辑、可发布的研究流程；被阻断节点是安全结果。</p>
            </div>
          </header>
          <form onSubmit={onImportDify}>
            <label>
              目标项目
              <select
                name="projectId"
                required
                value={selectedProject}
                onChange={(event) => onSelectProject(event.target.value)}
              >
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              绑定项目数据源
              <select name="projectSourceId" required defaultValue="">
                <option value="" disabled>
                  {projectSources.length ? '选择可运行来源' : '请先在项目页登记来源'}
                </option>
                {projectSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} · {source.kind}
                  </option>
                ))}
              </select>
            </label>
            <label className="file-drop">
              YAML / YML 文件
              <input
                name="file"
                type="file"
                accept=".yaml,.yml,application/yaml,text/yaml"
                required
              />
              <small>仅导入节点、连接与安全配置；密钥值不会落库。</small>
            </label>
            <button disabled={busy || !projects.length || !projectSources.length}>
              导入并打开画布
            </button>
          </form>
          {!projectSources.length && (
            <p className="integration-warning">
              当前项目没有数据源。请先回到“项目”登记并试运行来源，避免生成不可执行的默认 Web 节点。
            </p>
          )}
        </section>

        <section className="integration-card">
          <header>
            <span>WH</span>
            <div>
              <h3>Webhook 触发器</h3>
              <p>外部系统通过一次性令牌触发已发布工作流。</p>
            </div>
          </header>
          <form onSubmit={onCreateWebhook}>
            <label>
              项目
              <select
                name="projectId"
                required
                value={selectedProject}
                onChange={(event) => onSelectProject(event.target.value)}
              >
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              触发器名称
              <input name="name" required placeholder="例如：产品反馈入站" />
            </label>
            <label>
              已发布工作流
              <select name="workflowId" required defaultValue="">
                <option value="" disabled>
                  选择研究流程
                </option>
                {projectWorkflows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · v{item.published_version}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy || !projectWorkflows.length}>创建触发器</button>
          </form>
          {webhookToken && (
            <div className="secret-reveal" role="status">
              <strong>触发地址仅在本次显示</strong>
              <code>{webhookToken}</code>
              <button type="button" onClick={() => void onCopyText('webhook', webhookToken)}>
                {copied === 'webhook' ? '已复制' : '复制地址'}
              </button>
            </div>
          )}
          <div className="webhook-list">
            {webhooks.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.last_triggered_at
                      ? `最近触发 ${formatDate(item.last_triggered_at)}`
                      : '尚未触发'}
                  </small>
                </div>
                <button type="button" disabled={busy} onClick={() => void onToggleWebhook(item)}>
                  {item.enabled ? '停用' : '启用'}
                </button>
              </article>
            ))}
            {!webhooks.length && <p className="integration-empty">尚未创建触发器。</p>}
          </div>
        </section>

        <section className="integration-card mcp-card">
          <header>
            <span>MC</span>
            <div>
              <h3>开发者接口 / MCP</h3>
              <p>让外部工具与 AI Agent 在授权范围内查询能力、创建任务并读取执行结果。</p>
            </div>
          </header>
          <dl>
            <div>
              <dt>HTTP Endpoint</dt>
              <dd>
                <code>
                  {typeof location === 'undefined' ? '/api/mcp' : `${location.origin}/api/mcp`}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    void onCopyText(
                      'mcp',
                      typeof location === 'undefined' ? '/api/mcp' : `${location.origin}/api/mcp`,
                    )
                  }
                >
                  {copied === 'mcp' ? '已复制' : '复制'}
                </button>
              </dd>
            </div>
            <div>
              <dt>认证方式</dt>
              <dd>
                <code>Authorization: Bearer threadbeacon_…</code>
              </dd>
            </div>
            <div>
              <dt>传输协议</dt>
              <dd>Streamable HTTP · JSON-RPC 2.0</dd>
            </div>
          </dl>
          <pre>{`{\n  "mcpServers": {\n    "threadbeacon": {\n      "url": "${
            typeof location === 'undefined' ? 'https://YOUR_HOST/api/mcp' : `${location.origin}/api/mcp`
          }",\n      "headers": { "Authorization": "Bearer YOUR_TOKEN" }\n    }\n  }\n}`}</pre>
          <a href="/api/mcp" target="_blank" rel="noreferrer">
            检查 MCP 服务信息 ↗
          </a>
          <div className="token-manager">
            <div>
              <h4>Personal API Tokens</h4>
              <p>明文仅创建时显示，不会保存在浏览器中。</p>
            </div>
            <form onSubmit={onCreateToken}>
              <input name="name" required placeholder="Token 名称" aria-label="Token 名称" />
              <select name="expiresInDays" defaultValue="30" aria-label="有效期">
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">1 年</option>
              </select>
              <button disabled={busy}>创建 Token</button>
            </form>
            {plainToken && (
              <div className="secret-reveal token-secret" role="status">
                <strong>请立即复制，关闭页面后无法再次查看</strong>
                <code>{plainToken}</code>
                <button type="button" onClick={() => void onCopyText('token', plainToken)}>
                  {copied === 'token' ? '已复制' : '复制 Token'}
                </button>
              </div>
            )}
            <div className="token-list">
              {apiTokens.map((token) => (
                <article key={token.id}>
                  <div>
                    <strong>{token.name}</strong>
                    <small>
                      {token.token_prefix ?? 'threadbeacon_…'} ·{' '}
                      {token.expires_at ? `到期 ${formatDate(token.expires_at)}` : '未提供到期时间'}
                      {token.last_used_at ? ` · 最近使用 ${formatDate(token.last_used_at)}` : ''}
                    </small>
                  </div>
                  <b className={token.revoked_at ? 'revoked' : 'active'}>
                    {token.revoked_at ? '已撤销' : '有效'}
                  </b>
                  {!token.revoked_at && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onRevokeToken(token.id)}
                    >
                      撤销
                    </button>
                  )}
                </article>
              ))}
              {!apiTokens.length && <p className="integration-empty">尚未创建 API Token。</p>}
            </div>
          </div>
        </section>
      </div>
      <div className="capability-note">
        <strong>运行时能力动态发现</strong>
        <p>
          平台目录由在线 Worker 的 capabilities_json 动态聚合；任意符合 opencli:&lt;site&gt; 的只读适配器都可以进入来源节点，无需等待前端重新发版。
        </p>
      </div>
    </div>
  );
}
