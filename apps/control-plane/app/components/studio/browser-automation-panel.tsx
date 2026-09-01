'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiJson } from '../api-json.js';
import { formatDate, safeJson, type BrowserAction, type BrowserSession, type Profile, type WorkerNode } from './types.js';

export function BrowserAutomationPanel({
  profiles,
  nodes,
  canWrite,
}: {
  profiles: Profile[];
  nodes: WorkerNode[];
  canWrite: boolean;
}) {
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [actions, setActions] = useState<BrowserAction[]>([]);
  const [selected, setSelected] = useState('');
  const [actionType, setActionType] = useState('tabs.list');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/browser', { cache: 'no-store' });
      const body = (await apiJson(response)) as {
        sessions?: BrowserSession[];
        actions?: BrowserAction[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? '浏览器会话加载失败');
      setSessions(body.sessions ?? []);
      setActions(body.actions ?? []);
      setSelected((value) =>
        value && (body.sessions ?? []).some((item) => item.id === value)
          ? value
          : body.sessions?.[0]?.id ?? '',
      );
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '浏览器会话加载失败');
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const session = sessions.find((item) => item.id === selected);
  const sessionActions = actions.filter((item) => item.session_id === selected);

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch('/api/browser', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: values.get('profileId'),
          nodeId: values.get('nodeId') || undefined,
          allowlist: String(values.get('allowlist') ?? '')
            .split(/[\s,]+/)
            .filter(Boolean),
          timeoutMs: Number(values.get('timeoutMs')),
          ttlHours: Number(values.get('ttlHours')),
        }),
      });
      const body = (await apiJson(response)) as {
        session?: BrowserSession;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? '创建会话失败');
      form.reset();
      if (body.session) setSelected(body.session.id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建会话失败');
    } finally {
      setLoading(false);
    }
  }

  async function closeSession() {
    if (!session) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/browser/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      });
      const body = (await apiJson(response)) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '关闭失败');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '关闭失败');
    } finally {
      setLoading(false);
    }
  }

  async function queueAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setLoading(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    const input: Record<string, unknown> = {};
    const targetId = String(values.get('targetId') ?? '').trim();
    const url = String(values.get('url') ?? '').trim();
    const selector = String(values.get('selector') ?? '').trim();
    const text = String(values.get('text') ?? '');

    if (targetId) input.targetId = targetId;
    if (url) input.url = url;
    if (selector) input.selector = selector;
    if (text) input.text = text;
    if (values.get('clear')) input.clear = true;

    try {
      const response = await fetch(`/api/browser/sessions/${session.id}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: actionType, input }),
      });
      const body = (await apiJson(response)) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '提交动作失败');
      form.reset();
      setActionType('tabs.list');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交动作失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="browser-automation">
      <div className="section-title">
        <div>
          <h3>受控浏览器自动化</h3>
          <p>
            动作经 Worker + Profile 绑定后使用 CDP 执行；禁止 JS/eval、私网与 allowlist 外导航，所有动作留审计。
          </p>
        </div>
        <button type="button" onClick={() => void load()}>
          刷新
        </button>
      </div>
      {message && <p className="browser-error">{message}</p>}
      <div className="browser-control-grid">
        <form className="compact-form browser-session-form" onSubmit={createSession}>
          <h4>创建会话</h4>
          <select name="profileId" required defaultValue="">
            <option value="" disabled>
              选择浏览器 Profile
            </option>
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select name="nodeId" defaultValue="">
            <option value="">按 Profile 自动路由 Worker</option>
            {nodes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.status}
              </option>
            ))}
          </select>
          <textarea
            name="allowlist"
            required
            placeholder="允许域名，逗号或换行分隔，例如 example.com, *.example.org"
          />
          <label>
            动作超时{' '}
            <input name="timeoutMs" type="number" min="3000" max="60000" defaultValue="30000" />
          </label>
          <label>
            会话时长 <input name="ttlHours" type="number" min="1" max="24" defaultValue="2" />
          </label>
          <button disabled={!canWrite || loading || !profiles.length}>创建并连接</button>
          {!profiles.length && (
            <small>请先创建浏览器 Profile，并确保绑定 Worker 已配置 CDP endpoint。</small>
          )}
        </form>
        <div className="browser-session-list">
          <h4>会话</h4>
          {sessions.length === 0 ? (
            <p>暂无会话</p>
          ) : (
            sessions.map((item) => {
              const profile = profiles.find((value) => value.id === item.profile_id);
              const node = nodes.find((value) => value.id === item.node_id);
              return (
                <button
                  type="button"
                  key={item.id}
                  className={selected === item.id ? 'selected' : ''}
                  onClick={() => setSelected(item.id)}
                >
                  <span>
                    <strong>{profile?.name ?? item.profile_id}</strong>
                    <small>
                      {node?.name ?? item.node_id} · {item.capability}
                    </small>
                  </span>
                  <b className={item.status}>{item.status}</b>
                </button>
              );
            })
          )}
        </div>
      </div>
      {session && (
        <div className="browser-action-workbench">
          <header>
            <div>
              <strong>{session.id}</strong>
              <small>
                Target {session.target_id ?? '等待创建'} · 超时 {session.timeout_ms}ms · 到期{' '}
                {formatDate(session.expires_at)}
              </small>
              <code>{safeJson<string[]>(session.allowlist_json, []).join(' · ')}</code>
            </div>
            <button
              type="button"
              disabled={!canWrite || loading || ['closed', 'closing'].includes(session.status)}
              onClick={() => void closeSession()}
            >
              关闭会话
            </button>
          </header>
          {session.last_error && <p className="browser-error">{session.last_error}</p>}
          <form onSubmit={queueAction}>
            <select value={actionType} onChange={(event) => setActionType(event.target.value)}>
              <option value="tabs.list">列出标签页</option>
              <option value="tabs.open">打开标签页</option>
              <option value="tabs.close">关闭标签页</option>
              <option value="navigate">导航</option>
              <option value="snapshot">无障碍快照</option>
              <option value="click">点击元素</option>
              <option value="type">输入文本</option>
              <option value="screenshot">截图</option>
            </select>
            {['tabs.open', 'navigate'].includes(actionType) && (
              <input name="url" type="url" required placeholder="allowlist 内的公开 HTTPS URL" />
            )}
            {['tabs.close'].includes(actionType) && (
              <input name="targetId" required placeholder="标签页 Target ID" />
            )}
            {['click', 'type'].includes(actionType) && (
              <input name="selector" required placeholder="CSS selector（不支持脚本）" />
            )}
            {actionType === 'type' && (
              <>
                <input
                  name="text"
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="输入内容（不会出现在审计与结果中）"
                />
                <label>
                  <input name="clear" type="checkbox" /> 清空原值
                </label>
              </>
            )}
            <button disabled={!canWrite || loading || !['active', 'starting'].includes(session.status)}>
              提交动作
            </button>
          </form>
          <div className="browser-action-list">
            {sessionActions.length === 0 ? (
              <p>暂无动作</p>
            ) : (
              sessionActions.map((item) => {
                const result = safeJson<Record<string, unknown>>(item.result_json ?? '', {});
                return (
                  <article key={item.id}>
                    <i>{item.type}</i>
                    <div>
                      <strong>{item.status}</strong>
                      <small>
                        {formatDate(item.created_at)} · {item.node_id}
                      </small>
                      {item.error && <em>{item.error}</em>}
                      {Array.isArray(result['tabs']) && (
                        <code>
                          {(result['tabs'] as Array<{ title?: string; url?: string }>)
                            .map((tab) => `${tab.title || 'untitled'} ${tab.url || ''}`)
                            .join('\n')}
                        </code>
                      )}
                      {Array.isArray(result['snapshot']) && (
                        <details>
                          <summary>查看快照节点（最多 500）</summary>
                          <pre>{JSON.stringify(result['snapshot'], null, 2)}</pre>
                        </details>
                      )}
                    </div>
                    {item.screenshot_key && (
                      <a href={`/api/browser/actions/${item.id}/screenshot`} target="_blank" rel="noreferrer">
                        查看截图 ↗
                      </a>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>
      )}
    </section>
  );
}
