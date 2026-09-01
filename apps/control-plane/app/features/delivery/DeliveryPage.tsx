import { useState, type FormEvent } from 'react';
import { useApiQuery } from '../../api/use-api.js';
import { objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';
import { ProjectFrame } from '../projects/ProjectFrame.js';

export function DeliveryPage({ projectId }: { projectId: string }) {
  const reports = useApiQuery(() => v2.reports(projectId), [projectId]);
  const deliveries = useApiQuery(() => v2.deliveries(projectId), [projectId]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const reportItems = list(reports.data, 'reports', 'versions', 'items');
  const deliveryItems = list(deliveries.data, 'deliveries', 'operations', 'items');
  async function createDelivery(reportId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(reportId); setError(null); setResult(null);
    const form = new FormData(event.currentTarget);
    try { setResult(await v2.createDelivery(reportId, { channel: String(form.get('channel') ?? '').trim(), destination: String(form.get('destination') ?? '').trim(), idempotencyKey: crypto.randomUUID() })); deliveries.retry(); event.currentTarget.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason : new Error('创建交付操作失败。')); }
    finally { setBusy(''); }
  }
  return <ProjectFrame projectId={projectId} section="delivery"><div className="tb-page"><PageHeader eyebrow="REPORTS / DELIVERY OPERATIONS" title="报告与交付" description="正式报告是不可变版本；Delivery Operation、Attempt 和业务 Outcome 分层展示。" actions={<Link to={`/projects/${encodeURIComponent(projectId)}/data`} className="tb-button tb-button-secondary">返回数据与证据</Link>}/>{error && <div className="tb-form-error" role="alert"><strong>交付未创建</strong><span>{error.message}</span></div>}<div className="tb-two-column"><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">REPORT VERSIONS</p><h2>项目报告</h2><p>报告列表默认不展开 raw JSON；详情页展示摘要和精确证据引用。</p></div><span className="tb-count-pill">{reportItems.length} 份</span></header><DataState loading={reports.loading} error={reports.error} retry={reports.retry} empty={<EmptyState title="暂无报告版本" description="运行完成并形成已批准 Finding 后，报告版本会在这里出现。"/>}>{reportItems.length === 0 ? <EmptyState title="暂无报告版本" description="v2 返回空列表，当前项目还没有可交付的报告。"/> : <div className="tb-report-list">{reportItems.map((report, index) => {const id = objectId(report); return <article key={id || index}><div className="tb-report-icon">▤</div><div><strong>{value(report, 'title', value(report, 'name', `报告 Version ${index + 1}`))}</strong><small>{value(report, 'status', 'unknown')} · {value(report, 'createdAt', value(report, 'publishedAt', '时间未提供'))}</small></div><StatusBadge value={report.status ?? report.reviewStatus ?? 'unknown'}/>{id && <Link to={`/reports/${encodeURIComponent(id)}`}>阅读 →</Link>}{id && <form onSubmit={event => void createDelivery(id, event)} className="tb-delivery-mini-form"><input name="channel" required placeholder="渠道" aria-label="交付渠道"/><input name="destination" required placeholder="目标" aria-label="交付目标"/><button type="submit" className="tb-button tb-button-secondary" disabled={busy === id}>{busy === id ? '提交…' : '交付'}</button></form>}</article>})}</div>}</DataState></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">DELIVERY OPERATIONS</p><h2>交付状态</h2><p>HTTP 2xx 只代表技术提交，不自动代表业务已送达；unknown 进入待处理中心。</p></div><span className="tb-count-pill">{deliveryItems.length} 项</span></header><DataState loading={deliveries.loading} error={deliveries.error} retry={deliveries.retry} empty={<EmptyState title="暂无交付操作" description="从左侧报告发起交付，操作和尝试会以稳定 Operation ID 追踪。"/>}>{deliveryItems.length === 0 ? <EmptyState title="暂无交付操作" description="当前项目尚未创建 Delivery Operation。"/> : <div className="tb-delivery-list">{deliveryItems.map((item, index) => <article key={objectId(item) || index}><span className="tb-delivery-icon">↗</span><div><strong>{value(item, 'channel', value(item, 'destination', '交付操作'))}</strong><p>Operation {value(item, 'operationId', objectId(item) || '—')}</p><small>{value(item, 'businessOutcome', value(item, 'outcome', '结果未确认'))} · {value(item, 'lastAttemptAt', value(item, 'updatedAt', '时间未提供'))}</small></div><StatusBadge value={item.status ?? item.outcome ?? 'unknown'}/></article>)}</div>}</DataState>{result !== null && <JsonDetails value={result} label="查看最近交付响应"/>}</section></div><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">VERSIONED REPORTING</p><h2>报告草稿与发布</h2><p>需要创建报告草稿时，服务端会校验 Finding revision 和 Evidence Link；发布后版本不可修改。</p></div></header><div className="tb-contract-note"><span>i</span><p>本页不会把技术提交成功渲染成“已送达”。业务 Outcome 以 `/api/v2/deliveries/:id` 权威响应为准。</p></div><JsonDetails value={{ reports: reports.data, deliveries: deliveries.data }} label="查看报告与交付响应"/></section></div></ProjectFrame>;
}
