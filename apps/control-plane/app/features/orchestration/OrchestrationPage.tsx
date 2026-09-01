import { useEffect, useState, type FormEvent } from 'react';
import { useApiQuery } from '../../api/use-api.js';
import { asRecord, objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';
import { ProjectFrame } from '../projects/ProjectFrame.js';

export function OrchestrationPage({ projectId }: { projectId: string }) {
  const workflows = useApiQuery(() => v2.workflows(projectId), [projectId]);
  const items = list(workflows.data, 'workflows', 'items');
  const [selectedId, setSelectedId] = useState('');
  const [actionError, setActionError] = useState<Error | null>(null);
  const [actionResult, setActionResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!selectedId && items[0]) setSelectedId(objectId(items[0]));
  }, [items, selectedId]);
  const draft = useApiQuery(() => selectedId ? v2.workflowDraft(selectedId) : Promise.resolve(null), [selectedId]);
  const versions = useApiQuery(() => selectedId ? v2.workflowVersions(selectedId) : Promise.resolve(null), [selectedId]);
  const selected = items.find(item => objectId(item) === selectedId);
  async function mutate(action: 'validate' | 'publish') {
    if (!selectedId) return;
    setBusy(true); setActionError(null); setActionResult(null);
    try {
      const revision = value(draft.data, 'revision', '');
      const result = action === 'validate' ? await v2.validateWorkflow(selectedId, { revision }) : await v2.publishWorkflow(selectedId, { revision });
      setActionResult(result); draft.retry(); versions.retry(); workflows.retry();
    } catch (reason) { setActionError(reason instanceof Error ? reason : new Error(`${action} 请求失败。`)); }
    finally { setBusy(false); }
  }
  async function createWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setActionError(null);
    const form = new FormData(event.currentTarget);
    try { const result = await v2.createWorkflow(projectId, { name: String(form.get('name') ?? '').trim(), description: String(form.get('description') ?? '').trim() }); const id = objectId(result) || objectId(asRecord(result).workflow); if (id) setSelectedId(id); workflows.retry(); event.currentTarget.reset(); }
    catch (reason) { setActionError(reason instanceof Error ? reason : new Error('创建流程失败。')); }
    finally { setBusy(false); }
  }
  async function runVersion(versionId: string) {
    if (!versionId) return;
    setBusy(true); setActionError(null); setActionResult(null);
    try {
      setActionResult(await v2.createRun(versionId));
      workflows.retry();
    } catch (reason) { setActionError(reason instanceof Error ? reason : new Error('创建 Run 失败。')); }
    finally { setBusy(false); }
  }
  return <ProjectFrame projectId={projectId} section="orchestration"><div className="tb-page"><PageHeader eyebrow="ORCHESTRATION / WORKFLOW LIFECYCLE" title="编排" description="Draft 可编辑，Validate 产出结构化问题，Publish 固化不可变 Workflow Version。" actions={<Link to={`/projects/${encodeURIComponent(projectId)}/operations`} className="tb-button tb-button-primary">查看运行 →</Link>}/>{actionError && <div className="tb-form-error" role="alert"><strong>操作未完成</strong><span>{actionError.message}</span></div>}<div className="tb-orchestration-grid"><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">PRIMARY WORKFLOW</p><h2>研究流程草稿</h2><p>Run 只绑定已发布版本，不读取可变草稿。</p></div><span className="tb-count-pill">{items.length} 个</span></header><DataState loading={workflows.loading} error={workflows.error} retry={workflows.retry} empty={<EmptyState title="还没有流程" description="创建一个流程草稿，随后在右侧校验并发布。"/>}>{items.length === 0 ? <EmptyState title="还没有流程" description="v2 返回空列表，创建流程以开始版本化研究。"/> : <div className="tb-workflow-list">{items.map(item => {const id = objectId(item); return <button key={id} type="button" className={selectedId === id ? 'active' : ''} onClick={() => setSelectedId(id)}><span className="tb-list-icon">◇</span><span><strong>{value(item, 'name', value(item, 'title', '未命名流程'))}</strong><small>{value(item, 'status', 'draft')} · revision {value(item, 'revision', '—')}</small></span><StatusBadge value={item.status ?? 'draft'}/></button>})}</div>}</DataState><form className="tb-inline-form" onSubmit={createWorkflow}><input name="name" required placeholder="新流程名称"/><input name="description" placeholder="一句话说明（可选）"/><button className="tb-button tb-button-secondary" disabled={busy}>创建草稿</button></form></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">DRAFT / VALIDATION</p><h2>{selected ? value(selected, 'name', '流程草稿') : '选择一个流程'}</h2><p>高级 DAG 详情只在流程上下文中展开。</p></div>{selected && <StatusBadge value={selected.status ?? 'draft'}/>}</header>{!selected ? <EmptyState title="还没有选中的流程" description="从左侧选择一个流程，或先创建草稿。"/> : <><DataState loading={draft.loading} error={draft.error} retry={draft.retry} empty={<EmptyState title="草稿暂无内容" description="v2 尚未返回该流程的草稿定义。"/>}>{draft.data !== null && <div className="tb-draft-summary"><div><span>当前 revision</span><strong>{value(draft.data, 'revision', '—')}</strong></div><div><span>节点</span><strong>{String(list(draft.data, 'nodes', 'steps').length)}</strong></div><div><span>状态</span><strong>{value(draft.data, 'status', 'draft')}</strong></div></div>}</DataState><div className="tb-action-row"><button type="button" className="tb-button tb-button-secondary" onClick={() => void mutate('validate')} disabled={busy || draft.loading}>{busy ? '处理中…' : '校验草稿'}</button><button type="button" className="tb-button tb-button-primary" onClick={() => void mutate('publish')} disabled={busy || draft.loading}>{busy ? '处理中…' : '发布版本'}</button></div>{actionResult !== null && <JsonDetails value={actionResult} label="查看最近校验/发布响应"/>}</>}</section></div><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">IMMUTABLE VERSIONS</p><h2>已发布版本</h2><p>修改草稿不会改变历史版本或运行记录。</p></div></header><DataState loading={versions.loading} error={versions.error} retry={versions.retry} empty={<EmptyState title="暂无已发布版本" description="通过校验后发布的 Workflow Version 会出现在这里。"/>}>{list(versions.data, 'versions', 'workflowVersions', 'items').length === 0 ? <EmptyState title="暂无已发布版本" description="当前流程尚未发布不可变版本。"/> : <div className="tb-version-list">{list(versions.data, 'versions', 'workflowVersions', 'items').map((version, index) => {const versionId = objectId(version); return <article key={versionId || index}><div><strong>Version {value(version, 'version', value(version, 'number', String(index + 1)))}</strong><small>{value(version, 'publishedAt', value(version, 'createdAt', '时间未提供'))}</small></div><StatusBadge value={version.status ?? 'published'}/><button type="button" className="tb-button tb-button-secondary" onClick={() => void runVersion(versionId)} disabled={busy || !versionId}>{busy ? '创建中…' : '运行此版本'}</button><Link to={`/projects/${encodeURIComponent(projectId)}/operations`}>查看运行 →</Link></article>})}</div>}</DataState><JsonDetails value={versions.data} label="查看版本响应"/></section></div></ProjectFrame>;
}
