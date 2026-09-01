import { useEffect, useState } from 'react';
import { useApiQuery } from '../../api/use-api.js';
import { objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';
import { ProjectFrame } from '../projects/ProjectFrame.js';

export function OperationsPage({ projectId }: { projectId: string }) {
  const runs = useApiQuery(() => v2.projectRuns(projectId), [projectId]);
  const items = list(runs.data, 'runs', 'items');
  const [selectedId, setSelectedId] = useState('');
  const [actionError, setActionError] = useState<Error | null>(null);
  const [actionResult, setActionResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!selectedId && items[0]) setSelectedId(objectId(items[0])); }, [items, selectedId]);
  const selected = items.find(item => objectId(item) === selectedId);
  const detail = useApiQuery(() => selectedId ? v2.run(selectedId) : Promise.resolve(null), [selectedId]);
  const events = useApiQuery(() => selectedId ? v2.runEvents(selectedId) : Promise.resolve(null), [selectedId]);
  async function act(action: 'cancel' | 'retry' | 'resume') {
    if (!selectedId) return;
    setBusy(true); setActionError(null); setActionResult(null);
    try { setActionResult(await v2.runAction(selectedId, action, {})); runs.retry(); detail.retry(); events.retry(); }
    catch (reason) { setActionError(reason instanceof Error ? reason : new Error('运行操作失败。')); }
    finally { setBusy(false); }
  }
  return <ProjectFrame projectId={projectId} section="operations"><div className="tb-page"><PageHeader eyebrow="OPERATIONS / RUN TRACE" title="运行" description="每次研究执行绑定明确的 Workflow Version；Job 只作为高级详情，不成为主导航对象。" actions={<Link to={`/projects/${encodeURIComponent(projectId)}/orchestration`} className="tb-button tb-button-secondary">返回编排</Link>}/>{actionError && <div className="tb-form-error" role="alert"><strong>运行操作未完成</strong><span>{actionError.message}</span></div>}<div className="tb-operation-grid"><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">PROJECT RUNS</p><h2>研究运行</h2><p>queued → running → waiting_review / blocked → succeeded / failed。</p></div><span className="tb-count-pill">{items.length} 次</span></header><DataState loading={runs.loading} error={runs.error} retry={runs.retry} empty={<EmptyState title="还没有运行" description="从已发布的 Workflow Version 创建 Run 后，它会出现在这里。"/>}>{items.length === 0 ? <EmptyState title="还没有运行" description="v2 返回空列表，先发布一个流程版本再运行。"/> : <div className="tb-run-list">{items.map(item => {const id = objectId(item); return <button type="button" key={id} className={id === selectedId ? 'active' : ''} onClick={() => setSelectedId(id)}><span className="tb-run-dot"/><span><strong>{value(item, 'name', `Run ${id.slice(0, 8)}`)}</strong><small>{value(item, 'triggerType', value(item, 'trigger', 'manual'))} · {value(item, 'workflowVersionId', value(item, 'version', '版本未提供'))}</small></span><StatusBadge value={item.status ?? 'unknown'}/></button>})}</div>}</DataState></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">RUN DETAIL</p><h2>{selected ? value(selected, 'name', `Run ${selectedId.slice(0, 8)}`) : '选择一次运行'}</h2><p>节点 attempt、Trace 和恢复动作来自 Run 详情接口。</p></div>{selected && <StatusBadge value={selected.status ?? 'unknown'}/>}</header>{!selected ? <EmptyState title="还没有选中的运行" description="从左侧选择一个 Run 查看详情与节点事件。"/> : <><DataState loading={detail.loading} error={detail.error} retry={detail.retry} empty={<EmptyState title="暂无运行详情" description="v2 尚未返回该 Run 的详细投影。"/>}>{detail.data !== null && <div className="tb-run-summary"><div><span>状态</span><strong>{value(detail.data, 'status', value(selected, 'status', 'unknown'))}</strong></div><div><span>Workflow Version</span><strong>{value(detail.data, 'workflowVersionId', '—')}</strong></div><div><span>开始时间</span><strong>{value(detail.data, 'startedAt', '—')}</strong></div><div><span>更新时间</span><strong>{value(detail.data, 'updatedAt', '—')}</strong></div></div>}</DataState><div className="tb-action-row"><button type="button" className="tb-button tb-button-secondary" onClick={() => void act('retry')} disabled={busy}>重试失败节点</button><button type="button" className="tb-button tb-button-secondary" onClick={() => void act('resume')} disabled={busy}>从检查点恢复</button><button type="button" className="tb-button tb-button-danger" onClick={() => void act('cancel')} disabled={busy}>取消运行</button></div><DataState loading={events.loading} error={events.error} retry={events.retry} empty={<EmptyState title="暂无节点事件" description="事件会在 Worker 回传后投影到 Run Trace。"/>}>{list(events.data, 'events', 'items').length === 0 ? <EmptyState title="暂无节点事件" description="当前 Run 尚未产生可见 Trace。"/> : <div className="tb-event-list">{list(events.data, 'events', 'items').map((event, index) => <article key={objectId(event) || index}><i/><div><strong>{value(event, 'type', value(event, 'name', '节点事件'))}</strong><p>{value(event, 'message', value(event, 'error', '未提供事件说明'))}</p><small>{value(event, 'createdAt', value(event, 'timestamp', '时间未提供'))}</small></div></article>)}</div>}</DataState>{actionResult !== null && <JsonDetails value={actionResult} label="查看最近运行操作响应"/>}</>}</section></div><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">TRACE CONTRACT</p><h2>可观察性边界</h2><p>原始事件不被覆盖，重试属于同一 Run 的新 attempt；错误需要带稳定 code 与修复入口。</p></div></header><JsonDetails value={{ run: detail.data, events: events.data }} label="查看 Run 与事件响应"/></section></div></ProjectFrame>;
}
