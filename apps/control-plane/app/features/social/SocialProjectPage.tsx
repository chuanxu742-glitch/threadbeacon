import { useState } from 'react';
import { useApiQuery } from '../../api/use-api.js';
import { asRecord, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, MetricCard } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';
import { ProjectFrame } from '../projects/ProjectFrame.js';
import { MonitorManager, SocialFilterBar, SocialPageHeader, SocialReadOnlyNote, type SocialPage, responseItems } from './social-shared.js';

const entries: Array<[SocialPage, string, string]> = [
  ['streams', '监听流', '按监控查看最新采集事件'],
  ['accounts', '账号投影', 'Observation 派生与来源连接'],
  ['content', '内容', '公开内容和互动摘要'],
  ['insights', '趋势与洞察', '趋势、情绪、话题聚合'],
  ['alerts', '告警', '采集和连接异常'],
];

export function SocialProjectPage({ projectId }: { projectId: string }) {
  const [filters, setFilters] = useState({ platform: '', status: '', query: '' });
  const overview = useApiQuery(() => v2.projectSocial(projectId, 'overview', filters), [projectId, filters.platform, filters.status, filters.query]);
  const monitors = useApiQuery(() => v2.projectSocial(projectId, 'monitors', filters), [projectId, filters.platform, filters.status, filters.query]);
  const record = asRecord(overview.data);
  const projection = asRecord(record.overview ?? record);
  const metrics = asRecord(record.metrics ?? projection.metrics);
  const counts = asRecord(record.counts ?? projection.counts);
  const metric = (key: string, fallback = '—') => {
    const countKey: Record<string, string> = { activeMonitors: 'activeMonitors', monitorCount: 'monitors', contentCount: 'content', itemCount: 'content', openAlerts: 'openAlerts', alertCount: 'alerts' };
    return value(metrics, key, value(projection, key, value(counts, countKey[key] ?? key, fallback)));
  };
  const alertItems = responseItems(record, 'alerts');
  const itemCount = list(record, 'items', 'content', 'streams').length;
  return <ProjectFrame projectId={projectId} section="social"><div className="tb-page"><SocialPageHeader eyebrow={`PROJECT / ${projectId.slice(0, 12)} / SOCIAL`} title="社媒态势" description="项目内管理只读监听范围，并查看内容、账号、趋势和告警的同一份上下文。" projectId={projectId} active="overview" actions={<Link to={`/projects/${encodeURIComponent(projectId)}/orchestration`} className="tb-button tb-button-secondary">返回项目编排</Link>}/><DataState loading={overview.loading} error={overview.error} retry={overview.retry} empty={<EmptyState title="项目社媒态势暂时为空" description="等待 /api/v2/projects/:id/social/overview 返回服务端投影。"/>}>{overview.data === null ? <EmptyState title="项目社媒态势暂时为空" description="v2 返回空响应，无法推断项目社媒状态。"/> : <><section className="tb-metrics"><MetricCard label="活跃监控" value={metric('activeMonitors', metric('monitorCount'))} caption="只读监听" tone="blue"/><MetricCard label="内容信号" value={metric('contentCount', metric('itemCount', String(itemCount)))} caption="当前项目范围"/><MetricCard label="洞察主题" value={metric('topicCount', metric('insightCount'))} caption="待人工解释"/><MetricCard label="开放告警" value={metric('openAlerts', metric('alertCount', String(alertItems.length)))} caption="需要人工判断" tone="amber"/></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">SOCIAL VIEWS</p><h2>进入研究视图</h2><p>子页面共享这个项目 ID，不会切换到隐式全局项目。</p></div></header><div className="tb-social-entry-grid">{entries.map(([section, title, description]) => <Link key={section} to={`/projects/${encodeURIComponent(projectId)}/social/${section}`}><span>{section === 'streams' ? '↯' : section === 'accounts' ? '◎' : section === 'content' ? '▤' : section === 'insights' ? '◇' : '!'}</span><strong>{title}</strong><small>{description}</small><i>→</i></Link>)}</div></section><SocialFilterBar filters={filters} onChange={next => setFilters({ platform: next.platform ?? '', status: next.status ?? '', query: next.query ?? '' })}/><MonitorManager projectId={projectId} query={monitors}/><SocialReadOnlyNote>本项目社媒能力仅用于监听和证据回溯，不提供自动发帖、评论、点赞或 DM。</SocialReadOnlyNote><JsonDetails value={{ overview: overview.data, monitors: monitors.data }} label="查看项目社媒响应"/></>}</DataState></div></ProjectFrame>;
}
