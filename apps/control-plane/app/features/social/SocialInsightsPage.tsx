import { useState } from 'react';
import { asRecord, objectId } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, MetricCard, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, pickId, value } from '../shared.js';
import { ProjectFrame } from '../projects/ProjectFrame.js';
import { applySocialFilters, SocialCapabilityBadges, SocialFilterBar, SocialPageHeader, SocialReadOnlyNote, socialSentiment, socialStatus, useSocialQuery } from './social-shared.js';

function firstItems(...candidates: Array<ReturnType<typeof list>>): ReturnType<typeof list> {
  return candidates.find(items => items.length > 0) ?? [];
}

function countItems(source: unknown): ReturnType<typeof list> {
  const record = asRecord(source);
  return Object.entries(record).map(([name, count]) => ({ name, count }));
}

export function SocialInsightsPage({ projectId }: { projectId?: string }) {
  const [filters, setFilters] = useState({ platform: '', status: '', query: '', sentiment: '', topic: '' });
  const query = useSocialQuery(projectId, 'insights', filters);
  const record = asRecord(query.data);
  const nested = asRecord(record.insights ?? record.overview);
  const trends = applySocialFilters(firstItems(list(record, 'trends'), list(nested, 'trends'), list(record, 'byPlatform'), list(nested, 'byPlatform'), list(record, 'activity'), list(nested, 'activity'), list(record, 'items')), filters);
  const topics = applySocialFilters(firstItems(list(record, 'topics'), list(nested, 'topics'), countItems(record.changeTypes), countItems(nested.changeTypes)), filters);
  const sentimentSource = record.sentiment ?? nested.sentiment;
  const sentiment = asRecord(sentimentSource);
  const sentimentStatus = value(sentiment, 'status', '');
  const sentimentLabel = socialSentiment({ sentiment: sentimentSource }, '');
  const sentimentItems = list(sentimentSource, 'items', 'breakdown', 'values');
  const page = <div className="tb-page tb-social-page"><SocialPageHeader eyebrow={projectId ? 'PROJECT SOCIAL / INSIGHTS' : 'SOCIAL / INSIGHTS'} title="趋势与洞察" description={projectId ? '把趋势、情绪和话题作为可追溯的聚合投影展示；它们不是自动化决策，也不会直接触发外部动作。' : '全局入口展示 /api/v2/social/overview 返回的洞察样本；完整分页和项目筛选请进入具体项目。'} projectId={projectId} active="insights" actions={<Link to={projectId ? `/projects/${encodeURIComponent(projectId)}/social/content` : '/social/content'} className="tb-button tb-button-secondary">查看原始内容</Link>}/><SocialFilterBar filters={filters} onChange={next => setFilters({ platform: next.platform ?? '', status: next.status ?? '', query: next.query ?? '', sentiment: next.sentiment ?? '', topic: next.topic ?? '' })} includeSentiment includeTopic/><DataState loading={query.loading} error={query.error} retry={query.retry} empty={<EmptyState title="暂无社媒洞察" description="v2 尚未返回趋势、情绪或话题聚合。"/>}>{query.data === null ? <EmptyState title="暂无社媒洞察" description="v2 返回空响应，无法推断趋势或情绪。"/> : <><section className="tb-metrics"><MetricCard label="趋势数量" value={String(trends.length)} caption="服务端聚合" tone="blue"/><MetricCard label="正向情绪" value={value(sentiment, 'positive', value(sentiment, 'positiveCount', '—'))} caption="不等同于结论" tone="green"/><MetricCard label="中性情绪" value={value(sentiment, 'neutral', value(sentiment, 'neutralCount', '—'))} caption="服务端标签"/><MetricCard label="负向情绪" value={value(sentiment, 'negative', value(sentiment, 'negativeCount', '—'))} caption="进入人工判断" tone="amber"/></section><div className="tb-two-column"><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">TRENDS</p><h2>趋势变化</h2><p>方向和变化率以 v2 聚合响应为准。</p></div><span className="tb-count-pill">{trends.length} 项</span></header>{trends.length === 0 ? <EmptyState title="暂无趋势" description="当前筛选下没有趋势投影。"/> : <div className="tb-social-insight-list">{trends.slice(0, 30).map((item, index) => <article key={pickId(item) || objectId(item) || index}><span className="tb-social-insight-mark">↗</span><div><strong>{value(item, 'name', value(item, 'title', value(item, 'label', `趋势 ${index + 1}`)))}</strong><p>{value(item, 'summary', value(item, 'description', '未提供趋势说明'))}</p><small>{value(item, 'direction', '方向未提供')} · 变化 {value(item, 'change', value(item, 'changeRate', '—'))}</small><SocialCapabilityBadges item={item}/></div><StatusBadge value={socialStatus(item)}/></article>)}</div>}</section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">TOPICS</p><h2>话题聚合</h2><p>话题是观察索引，不自动生成发布建议。</p></div><span className="tb-count-pill">{topics.length} 项</span></header>{topics.length === 0 ? <EmptyState title="暂无话题" description="当前筛选下没有话题聚合。"/> : <div className="tb-social-topic-list">{topics.slice(0, 30).map((item, index) => <article key={pickId(item) || objectId(item) || index}><div><strong>{value(item, 'name', value(item, 'topic', value(item, 'title', `话题 ${index + 1}`)))}</strong><p>{value(item, 'summary', value(item, 'description', '未提供话题说明'))}</p></div><span>{value(item, 'count', value(item, 'itemCount', '—'))} 条</span></article>)}</div>}</section></div><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">SENTIMENT</p><h2>情绪分布</h2><p>情绪标签仅描述内容聚合，不代替 Finding Review。</p><div className="tb-social-sentiment-state">{sentimentStatus ? <StatusBadge value={sentimentStatus}/> : sentimentLabel ? <span>标签 · {sentimentLabel}</span> : <span>服务端未返回情绪状态</span>}</div></div><span className="tb-count-pill">{sentimentItems.length} 类</span></header>{sentimentItems.length === 0 ? <div className="tb-social-sentiment-grid"><MetricCard label="正向" value={value(sentiment, 'positive', value(sentiment, 'positiveCount', '—'))} tone="green"/><MetricCard label="中性" value={value(sentiment, 'neutral', value(sentiment, 'neutralCount', '—'))}/><MetricCard label="负向" value={value(sentiment, 'negative', value(sentiment, 'negativeCount', '—'))} tone="amber"/></div> : <div className="tb-social-sentiment-list">{sentimentItems.map((item, index) => <article key={pickId(item) || index}><strong>{value(item, 'label', value(item, 'sentiment', value(item, 'status', `情绪 ${index + 1}`)))}</strong><span>{value(item, 'count', value(item, 'value', '—'))}</span><StatusBadge value={socialStatus(item)}/></article>)}</div>}</section><SocialReadOnlyNote>洞察和情绪用于辅助研究员判断；不会自动发布内容、回复用户或发送 DM。</SocialReadOnlyNote><JsonDetails value={query.data} label="查看趋势与洞察响应"/></>}</DataState></div>;
  return projectId ? <ProjectFrame projectId={projectId} section="social">{page}</ProjectFrame> : page;
}
