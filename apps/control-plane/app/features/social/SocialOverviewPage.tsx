import { useState } from 'react';
import { useApiQuery } from '../../api/use-api.js';
import { asRecord, objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, MetricCard, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, value } from '../shared.js';
import { applySocialFilters, SocialCapabilityBadges, SocialFilterBar, SocialPageHeader, SocialReadOnlyNote, type SocialPage, responseItems } from './social-shared.js';

const cards: Array<[SocialPage, string, string]> = [
  ['streams', '监听流', '按平台与监控查看最新公开事件'],
  ['accounts', '账号投影', '查看 Observation 派生与连接边界'],
  ['content', '内容', '搜索公开内容与互动摘要'],
  ['insights', '趋势与洞察', '趋势、情绪和话题聚合'],
  ['alerts', '告警', '处理采集、授权与研究异常'],
];

export function SocialOverviewPage() {
  const overview = useApiQuery(v2.socialOverview, []);
  const [filters, setFilters] = useState({ platform: '', status: '', query: '' });
  const record = asRecord(overview.data);
  const projection = asRecord(record.overview ?? record);
  const metrics = asRecord(record.metrics ?? projection.metrics);
  const counts = asRecord(record.counts ?? projection.counts);
  const monitors = applySocialFilters(responseItems(record, 'monitors'), filters);
  const items = applySocialFilters(responseItems(record, 'items', 'content', 'streams'), filters);
  const alerts = applySocialFilters(responseItems(record, 'alerts'), filters);
  const metric = (key: string, fallback = '—') => {
    const countKey: Record<string, string> = { activeMonitors: 'activeMonitors', monitorCount: 'monitors', contentCount: 'content', itemCount: 'content', openAlerts: 'openAlerts', alertCount: 'alerts' };
    return value(metrics, key, value(projection, key, value(counts, countKey[key] ?? key, fallback)));
  };
  return <div className="tb-page tb-social-page"><SocialPageHeader eyebrow="SOCIAL / CROSS-PROJECT SIGNAL" title="社媒态势" description="跨项目查看只读监听、平台连接、内容信号与需要人工判断的告警。项目仍是监控、证据和运行的唯一归属。" active="overview" actions={<Link to="/projects" className="tb-button tb-button-primary">进入项目创建监控 →</Link>}/><DataState loading={overview.loading} error={overview.error} retry={overview.retry} empty={<EmptyState title="社媒态势暂时为空" description="等待 /api/v2/social/overview 返回真实的平台与项目投影。"/>}>{overview.data === null ? <EmptyState title="社媒态势暂时为空" description="v2 返回空响应，无法推断平台或项目状态。"/> : <><section className="tb-metrics"><MetricCard label="活跃监控" value={metric('activeMonitors', metric('monitorCount'))} caption="跨项目只读监听" tone="blue"/><MetricCard label="今日内容" value={metric('contentCount', metric('itemCount'))} caption="服务端返回的内容统计"/><MetricCard label="负向情绪" value={metric('negativeSentiment', metric('negativeCount'))} caption="不代表人工结论" tone="amber"/><MetricCard label="待处理告警" value={metric('openAlerts', metric('alertCount'))} caption="授权、连接和采集异常" tone="red"/></section><section className="tb-social-overview-grid"><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">MONITOR HEALTH</p><h2>监控健康</h2><p>启停状态来自服务端；没有本地假数据。</p></div><Link to="/projects" className="tb-card-link">按项目管理 →</Link></header><SocialFilterBar filters={filters} onChange={next => setFilters({ platform: next.platform ?? '', status: next.status ?? '', query: next.query ?? '' })}/>{monitors.length === 0 ? <EmptyState title="暂无监控投影" description="全局 overview 尚未返回监控，进入具体项目创建。"/> : <div className="tb-social-monitor-list">{monitors.slice(0, 6).map((item, index) => {const id = objectId(item); const projectId = value(item, 'projectId', ''); return <article key={id || index}><div className="tb-social-monitor-icon">◎</div><div><strong>{value(item, 'name', value(item, 'query', `监控 ${index + 1}`))}</strong><p>{value(item, 'projectName', projectId || '项目未提供')} · {value(item, 'status', 'unknown')}</p><SocialCapabilityBadges item={item}/></div><StatusBadge value={item.status ?? 'unknown'}/>{projectId && <Link to={`/projects/${encodeURIComponent(projectId)}/social`}>打开 →</Link>}</article>})}</div>}</section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">ATTENTION SIGNALS</p><h2>需要判断的信号</h2><p>告警与内容信号只提供上下文，不自动执行外部动作。</p></div><Link to="/social/alerts" className="tb-card-link">全部告警 →</Link></header>{alerts.length === 0 ? <EmptyState title="暂无社媒告警" description="overview 没有返回需要人工处理的异常。"/> : <div className="tb-social-alert-list">{alerts.slice(0, 5).map((item, index) => <article key={objectId(item) || index}><StatusBadge value={item.severity ?? item.status ?? 'unknown'}/><div><strong>{value(item, 'title', value(item, 'message', '社媒信号'))}</strong><p>{value(item, 'description', value(item, 'reason', '未提供说明'))}</p><small>{value(item, 'platform', '平台未提供')} · {value(item, 'createdAt', value(item, 'lastCheckedAt', '时间未提供'))}</small></div></article>)}</div>}</section></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">SOCIAL WORKBENCH</p><h2>从信号进入具体视图</h2><p>所有链接都保留 global 或 project 上下文，避免跨项目误操作。</p></div></header><div className="tb-social-entry-grid">{cards.map(([section, title, description]) => <Link key={section} to={`/social/${section}`}><span>{section === 'streams' ? '↯' : section === 'accounts' ? '◎' : section === 'content' ? '▤' : section === 'insights' ? '◇' : '!'}</span><strong>{title}</strong><small>{description}</small><i>→</i></Link>)}</div></section><SocialReadOnlyNote>社媒域当前只做公开监听与用户明确授权数据读取；不会自动发帖、评论、点赞或发送 DM。</SocialReadOnlyNote><JsonDetails value={{ overview: overview.data, monitorCount: monitors.length, itemCount: items.length, alertCount: alerts.length }} label="查看社媒态势响应"/></>}</DataState></div>;
}
