import { useState, type FormEvent } from 'react';
import { useApiQuery } from '../../api/use-api.js';
import { asRecord, objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';

export function ProjectsPage() {
  const projects = useApiQuery(v2.projects, []);
  const items = list(projects.data, 'projects', 'items');
  return <div className="tb-page"><PageHeader eyebrow="PROJECTS / CONTINUOUS RESEARCH" title="项目" description="每个研究问题都有自己的来源、流程版本、运行、发现和交付。" actions={<Link to="/projects/new" className="tb-button tb-button-primary">新建项目 <span>＋</span></Link>}/><DataState loading={projects.loading} error={projects.error} retry={projects.retry} empty={<EmptyState title="还没有研究项目" description="从一个明确的研究问题开始，之后再添加来源和可版本化流程。" action={<Link to="/projects/new" className="tb-button tb-button-primary">创建第一个项目</Link>}/>}>{items.length === 0 ? <EmptyState title="还没有研究项目" description="v2 返回了空列表。创建项目后，它会成为所有运行与证据资产的主容器。" action={<Link to="/projects/new" className="tb-button tb-button-primary">创建第一个项目</Link>}/> : <div className="tb-project-grid">{items.map(project => {const id = objectId(project); return <article className="tb-project-card" key={id}><header><span className="tb-project-mark">{value(project, 'name', value(project, 'title', 'P')).slice(0, 1)}</span><StatusBadge value={project.status ?? project.readinessStatus ?? 'unknown'}/></header><h2>{value(project, 'name', value(project, 'title', '未命名项目'))}</h2><p>{value(project, 'goal', value(project, 'description', '尚未提供研究目标。'))}</p><dl><div><dt>负责人</dt><dd>{value(project, 'ownerName', value(project, 'owner', '—'))}</dd></div><div><dt>最近变化</dt><dd>{value(project, 'updatedAt', '—')}</dd></div></dl>{id ? <Link to={`/projects/${encodeURIComponent(id)}`} className="tb-card-link">进入项目 <span>→</span></Link> : <span className="tb-muted">缺少项目 ID，无法打开</span>}</article>})}</div>}</DataState></div>;
}

export function NewProjectPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await v2.createProject({ name: String(form.get('name') ?? '').trim(), goal: String(form.get('goal') ?? '').trim(), description: String(form.get('description') ?? '').trim() });
      const id = objectId(result) || objectId(asRecord(result).project);
      if (id) {
        window.history.pushState({}, '', `/projects/${encodeURIComponent(id)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      else setError(new Error('项目已提交，但 v2 响应缺少项目 ID，无法打开项目上下文。'));
    } catch (reason) { setError(reason instanceof Error ? reason : new Error('创建项目失败。')); }
    finally { setBusy(false); }
  }
  return <div className="tb-page tb-form-page"><PageHeader eyebrow="PROJECTS / NEW" title="创建研究项目" description="先定义持续研究的决策问题，再由项目上下文承载来源、流程、证据和报告。" actions={<Link to="/projects" className="tb-button tb-button-secondary">返回项目</Link>}/><form className="tb-card tb-form-card" onSubmit={submit}><div className="tb-form-intro"><span>01</span><div><h2>研究问题</h2><p>名称和目标会成为项目的长期语义，不是一次性任务关键词。</p></div></div>{error && <div className="tb-form-error" role="alert"><strong>项目未创建</strong><span>{error.message}</span></div>}<label>项目名称<input name="name" required maxLength={120} placeholder="例如：AI 编程助手竞品跟踪"/></label><label>研究目标<textarea name="goal" required rows={4} maxLength={1000} placeholder="要持续回答哪个决策问题？"/></label><label>补充说明（可选）<textarea name="description" rows={3} maxLength={2000} placeholder="团队、范围或交付节奏"/></label><div className="tb-form-actions"><Link to="/projects" className="tb-button tb-button-secondary">取消</Link><button className="tb-button tb-button-primary" disabled={busy}>{busy ? '正在创建…' : '创建并进入项目 →'}</button></div></form></div>;
}
