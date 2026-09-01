import { useApiQuery } from '../../api/use-api.js';
import { asRecord, text, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, MetricCard, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, pickId, value } from '../shared.js';

export function TodayPage() {
  const attention = useApiQuery(v2.attention, []);
  const context = useApiQuery(v2.context, []);
  const items = list(attention.data, 'attention', 'items');
  const contextRecord = asRecord(context.data);
  const pulse = asRecord(contextRecord.pulse ?? contextRecord.systemPulse);
  const ready = text(pulse.ready ?? contextRecord.readiness, '—');
  const active = text(pulse.activeRuns ?? pulse.runningRuns, '—');
  const reports = text(pulse.recentReports, '—');
  return <div className="tb-page tb-today-page"><PageHeader eyebrow="TODAY / ATTENTION CENTER" title="今天要处理什么？" description="从真实领域状态汇总阻塞、待复核和不确定交付；每一条都可回到权威对象。" actions={<Link to="/projects/new" className="tb-button tb-button-primary">新建研究项目 <span>→</span></Link>}/>
    <section className="tb-metrics"><MetricCard label="待处理项" value={attention.loading ? '…' : String(items.length)} caption="来自 /api/v2/attention" tone={items.length ? 'amber' : 'green'}/><MetricCard label="项目就绪度" value={context.loading ? '…' : ready} caption="由依赖与探测派生"/><MetricCard label="运行中" value={context.loading ? '…' : active} caption="当前工作区" tone="green"/><MetricCard label="最近报告" value={context.loading ? '…' : reports} caption="来自工作区上下文" tone="blue"/></section>
    <div className="tb-two-column tb-today-grid"><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">ATTENTION ITEMS</p><h2>待处理中心</h2><p>不改变 Run、Finding 或 Delivery 历史，只记录人的处理状态。</p></div>{items.length > 0 && <span className="tb-count-pill">{items.length} 项</span>}</header><DataState loading={attention.loading} error={attention.error} retry={attention.retry} empty={<EmptyState title="当前没有待处理项" description="阻塞运行、待复核发现和失败交付会在这里出现。"/>}>{items.length === 0 ? <EmptyState title="当前没有待处理项" description="阻塞运行、待复核发现和失败交付会在这里出现。"/> : <div className="tb-attention-list">{items.map((item, index) => {const id = pickId(item) || `attention-${index}`; const route = value(item, 'remediationRoute', ''); return <article key={id}><div className="tb-list-icon">!</div><div><div className="tb-list-title"><strong>{value(item, 'title', value(item, 'message', '需要处理的状态'))}</strong><StatusBadge value={item.status ?? item.severity ?? 'needs_approval'}/></div><p>{value(item, 'description', value(item, 'reason', '该状态需要进一步确认。'))}</p><small>{value(item, 'affectedObject', '权威对象')} · {value(item, 'createdAt', value(item, 'lastCheckedAt', '时间未提供'))}</small></div>{route && route.startsWith('/') && <Link to={route} className="tb-list-action">处理 →</Link>}</article>})}</div>}</DataState></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">SYSTEM PULSE</p><h2>工作区脉搏</h2><p>上下文接口未返回的字段不会被前端推断。</p></div></header><DataState loading={context.loading} error={context.error} retry={context.retry} empty={<EmptyState title="暂无系统脉搏" description="等待 /api/v2/me/context 提供当前工作区摘要。"/>}><div className="tb-pulse-grid"><div><span>就绪状态</span><strong>{ready}</strong></div><div><span>运行中</span><strong>{active}</strong></div><div><span>最近报告</span><strong>{reports}</strong></div><div><span>上下文</span><strong>{contextRecord.workspace ? '已连接' : '未返回'}</strong></div></div><JsonDetails value={context.data} label="查看工作区上下文响应"/></DataState></section></div>
  </div>;
}
