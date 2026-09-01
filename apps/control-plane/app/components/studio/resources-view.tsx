'use client';

import { type FormEvent } from 'react';
import { BrowserAutomationPanel } from './browser-automation-panel.js';
import { safeJson, safeProfileUrl, type Profile, type WorkerNode } from './types.js';

export function ResourcesView({
  nodes,
  profiles,
  canWrite,
  busy,
  onCreateProfile,
}: {
  nodes: WorkerNode[];
  profiles: Profile[];
  canWrite: boolean;
  busy: boolean;
  onCreateProfile: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="product-page">
      <div className="resource-layout">
        <section>
          <div className="section-title">
            <div>
              <h3>执行节点舰队</h3>
              <p>出站轮询、能力路由、来源账号授权与健康心跳</p>
            </div>
            <span>{nodes.filter((node) => node.status === 'online').length} 在线节点</span>
          </div>

          <div className="fleet-grid">
            {nodes.map((node) => {
              const runtime = safeJson<Record<string, unknown>>(node.runtime_json, {});
              const health = safeJson<Record<string, unknown>>(node.health_json, {});
              const caps = safeJson<string[]>(node.capabilities_json, []);
              const attestation =
                runtime['browserAttestation'] && typeof runtime['browserAttestation'] === 'object'
                  ? (runtime['browserAttestation'] as Record<string, unknown>)
                  : null;
              const browserReady =
                attestation?.['verified'] === true &&
                typeof attestation['expiresAt'] === 'string';

              return (
                <article key={node.id}>
                  <header>
                    <span className="worker-mark">⌘</span>
                    <div>
                      <strong>{node.name}</strong>
                      <small>
                        {node.platform} · v{node.version}
                      </small>
                    </div>
                    <b className={node.status}>{node.status}</b>
                  </header>
                  <dl>
                    <div>
                      <dt>并发槽位</dt>
                      <dd>
                        {node.active_jobs} / {node.max_concurrency}
                      </dd>
                    </div>
                    <div>
                      <dt>传输模式</dt>
                      <dd>{String(runtime['transport'] ?? 'worker')}</dd>
                    </div>
                    <div>
                      <dt>浏览器自动化</dt>
                      <dd>
                        {browserReady
                          ? `${String(attestation?.['profileKind'])} 已证明`
                          : '未通过 Profile 证明'}
                      </dd>
                    </div>
                    <div>
                      <dt>健康状态</dt>
                      <dd>{String(health['state'] ?? 'unknown')}</dd>
                    </div>
                  </dl>
                  <div className="cap-tags">
                    {caps.slice(0, 8).map((cap) => (
                      <code key={cap}>{cap}</code>
                    ))}
                    {caps.length > 8 && <code>+{caps.length - 8}</code>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="profile-panel">
          <div className="section-title">
            <div>
              <h3>来源账号授权</h3>
              <p>授权类型必须与执行节点的实时 CDP 证明一致。</p>
            </div>
          </div>
          <form className="compact-form" onSubmit={onCreateProfile}>
            <input name="name" required placeholder="配置显示名称" />
            <input name="profileName" required placeholder="Worker 中的 Profile 名" />
            <select name="profileKind">
              <option value="authenticated">登录态 Profile</option>
              <option value="anonymous">匿名干净 Profile</option>
            </select>
            <select name="mode">
              <option value="cdp">CDP</option>
              <option value="bridge">Bridge</option>
              <option value="local">Local</option>
            </select>
            <select name="nodeId" defaultValue="">
              <option value="">自动路由节点</option>
              {nodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
            <input name="sites" placeholder="站点绑定，逗号分隔" />
            <input name="noVncUrl" type="url" placeholder="noVNC HTTPS 地址（可选）" />
            <input name="cdpUrl" placeholder="CDP WSS 地址（可选，不展示密钥）" />
            <button disabled={busy || !canWrite}>保存 Profile</button>
          </form>

          <div className="profile-list">
            {profiles.map((item) => {
              const noVnc = safeProfileUrl(item.no_vnc_url ?? item.noVncUrl);
              const hasCdp = Boolean(item.cdp_url ?? item.cdpUrl);
              return (
                <article key={item.id}>
                  <i>◉</i>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.profile_name} · {item.mode} · {item.profile_kind ?? 'authenticated'}
                    </small>
                    <code>
                      {safeJson<string[]>(item.site_bindings_json, []).join(' · ') || '任意站点'}
                    </code>
                    <small>
                      CDP {hasCdp ? '已配置' : '未配置'} · 证明{' '}
                      {item.last_verified_at ? '有效记录' : '尚未验证'} · noVNC{' '}
                      {noVnc ? '可用' : '未配置'}
                    </small>
                  </div>
                  <span className="profile-actions">
                    <b>{item.status}</b>
                    {noVnc && (
                      <a href={noVnc} target="_blank" rel="noreferrer">
                        安全打开 ↗
                      </a>
                    )}
                  </span>
                </article>
              );
            })}
          </div>
        </aside>
      </div>

      <BrowserAutomationPanel profiles={profiles} nodes={nodes} canWrite={canWrite} />
    </div>
  );
}
