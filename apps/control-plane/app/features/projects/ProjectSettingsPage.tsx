import { useState, type FormEvent } from 'react';
import { useApiQuery } from '../../api/use-api.js';
import { asRecord, objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';
import { ProjectFrame } from './ProjectFrame.js';

export function ProjectSettingsPage({ projectId }: { projectId: string }) {
  const sources = useApiQuery(() => v2.projectSources(projectId), [projectId]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [probeResult, setProbeResult] = useState<unknown>(null);
  const items = list(sources.data, 'sources', 'projectSources', 'items');
  async function probe(id: string) {
    setBusy(id); setError(null); setProbeResult(null);
    try { setProbeResult(await v2.probeSource(projectId, id, {})); sources.retry(); }
    catch (reason) { setError(reason instanceof Error ? reason : new Error('来源探测失败。')); }
    finally { setBusy(''); }
  }
  async function createSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('new'); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const target = String(form.get('target') ?? '').trim();
      await v2.createSource(projectId, {
        name: String(form.get('name') ?? '').trim(),
        kind: String(form.get('kind') ?? '').trim(),
        url: target,
        connectionId: String(form.get('connectionId') ?? '').trim(),
      });
      sources.retry(); event.currentTarget.reset();
    }
    catch (reason) { setError(reason instanceof Error ? reason : new Error('创建来源失败。')); }
    finally { setBusy(''); }
  }
  return <ProjectFrame projectId={projectId} section="settings"><div className="tb-page"><PageHeader eyebrow="PROJECT SETTINGS / SOURCES" title="项目设置" description="配置 Project Source、Connection 引用、研究频率与保留策略；secret 不在前端展示。" actions={<Link to={`/projects/${encodeURIComponent(projectId)}`} className="tb-button tb-button-secondary">返回概览</Link>}/>{error && <div className="tb-form-error" role="alert"><strong>项目设置未更新</strong><span>{error.message}</span></div>}<section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">PROJECT SOURCES</p><h2>来源范围</h2><p>来源健康变化不修改历史 Run 和 Observation。</p></div><span className="tb-count-pill">{items.length} 个</span></header><DataState loading={sources.loading} error={sources.error} retry={sources.retry} empty={<EmptyState title="暂无项目来源" description="添加第一个来源后，再进行连接和内容探测。"/>}>{items.length === 0 ? <EmptyState title="暂无项目来源" description="v2 返回空列表，创建一个来源以定义研究范围。"/> : <div className="tb-source-list">{items.map((item, index) => {const id = objectId(item); return <article key={id || index}><span className="tb-source-icon">◎</span><div><strong>{value(item, 'name', value(item, 'url', '未命名来源'))}</strong><p>{value(item, 'kind', 'source')} · {value(item, 'connectionId', '无连接引用')}</p><small>最近成功 {value(item, 'lastSuccessAt', '—')} · 连续失败 {value(item, 'consecutiveFailures', '0')}</small></div><StatusBadge value={item.healthStatus ?? item.status ?? 'unknown'}/>{id && <button type="button" className="tb-button tb-button-secondary" onClick={() => void probe(id)} disabled={busy === id}>{busy === id ? '探测中…' : '探测来源'}</button>}</article>})}</div>}</DataState><form className="tb-source-form" onSubmit={createSource}><h3>添加 Project Source</h3><div><label>名称<input name="name" required placeholder="例如：官网更新"/></label><label>类型<input name="kind" required placeholder="rss / web / rest"/></label><label>目标<input name="target" required placeholder="https://example.com/feed.xml"/></label><label>Connection ID（可选）<input name="connectionId" placeholder="引用工作区连接"/></label></div><button type="submit" className="tb-button tb-button-primary" disabled={busy === 'new'}>{busy === 'new' ? '创建中…' : '保存来源'}</button></form>{probeResult !== null && <JsonDetails value={probeResult} label="查看最近探测响应"/>}<JsonDetails value={sources.data} label="查看 Project Source 响应"/></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">POLICY BOUNDARY</p><h2>项目与工作区的边界</h2><p>项目只引用工作区 Connection；凭据继续留在安全存储或执行节点。</p></div></header><div className="tb-contract-note"><span>✓</span><p>本页面不显示 secret、Worker Profile 或内部节点详情。需要治理共享能力时，请前往设置中心。</p></div><JsonDetails value={asRecord(sources.data)} label="查看来源能力响应"/></section></div></ProjectFrame>;
}
