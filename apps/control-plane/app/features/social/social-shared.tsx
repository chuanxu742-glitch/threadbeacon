import { useState, type FormEvent, type ReactNode } from 'react';
import { useApiQuery } from '../../api/use-api.js';
import { asRecord, objectId, type JsonRecord, type SocialFilters, type SocialSection, text, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, pickId, value } from '../shared.js';

export type SocialPage = SocialSection | 'streams';

export const socialTabs: Array<[SocialPage, string]> = [
  ['overview', '总览'],
  ['streams', '监听流'],
  ['accounts', '账号投影'],
  ['content', '内容'],
  ['insights', '趋势与洞察'],
  ['alerts', '告警'],
];

const globalPath = (section: SocialPage) => section === 'overview' ? '/social' : `/social/${section}`;
const projectPath = (projectId: string, section: SocialPage) => section === 'overview'
  ? `/projects/${encodeURIComponent(projectId)}/social`
  : `/projects/${encodeURIComponent(projectId)}/social/${section}`;

export function SocialSubnav({ projectId, active }: { projectId?: string; active: SocialPage }) {
  return <nav className="tb-social-nav" aria-label="社媒导航">{socialTabs.map(([section, label]) => <Link key={section} to={projectId ? projectPath(projectId, section) : globalPath(section)} className={active === section ? 'active' : ''} aria-current={active === section ? 'page' : undefined}>{label}</Link>)}</nav>;
}

export function SocialPageHeader({ eyebrow, title, description, projectId, active, actions }: { eyebrow: string; title: string; description: string; projectId?: string; active: SocialPage; actions?: ReactNode }) {
  return <><PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions}/><SocialSubnav projectId={projectId} active={active}/></>;
}

export function useSocialQuery(projectId: string | undefined, section: SocialSection, filters: SocialFilters = {}) {
  const values = Object.entries(filters).map(([, item]) => item ?? '');
  return useApiQuery(() => {
    if (projectId) return v2.projectSocial(projectId, section, filters);
    return section === 'alerts' ? v2.globalSocialAlerts(filters) : v2.socialOverview();
  }, [projectId, section, ...values]);
}

export function responseItems(data: unknown, ...keys: string[]): JsonRecord[] {
  const direct = list(data, ...keys);
  if (direct.length > 0) return direct;
  const record = asRecord(data);
  return list(record.overview, ...keys);
}

export function applySocialFilters(items: JsonRecord[], filters: SocialFilters): JsonRecord[] {
  const query = filters.query?.trim().toLowerCase();
  return items.filter(item => {
    const config = asRecord(item.config);
    const configuredPlatforms = Array.isArray(config.platforms) ? config.platforms.filter(item => typeof item === 'string').join(', ') : '';
    const platform = value(item, 'platform', value(item, 'platformName', configuredPlatforms)).toLowerCase();
    const status = String(socialStatus(item, '')).toLowerCase();
    const sentiment = socialSentiment(item, '').toLowerCase();
    const severity = value(item, 'severity', '').toLowerCase();
    const searchable = [
      value(item, 'title', ''), value(item, 'name', ''), value(item, 'query', ''),
      value(item, 'text', ''), value(item, 'content', ''), value(item, 'body', ''),
      socialAuthor(item, ''), socialTopics(item, ''), value(item, 'projectName', ''),
    ].join(' ').toLowerCase();
    const platformFilter = filters.platform?.toLowerCase();
    const platformMatches = !platformFilter || platform === platformFilter || platform.startsWith(`${platformFilter}:`);
    return platformMatches
      && (!filters.status || filters.status.toLowerCase() === 'all' || status === filters.status.toLowerCase())
      && (!filters.sentiment || sentiment.includes(filters.sentiment.toLowerCase()))
      && (!filters.severity || severity === filters.severity.toLowerCase())
      && (!filters.topic || searchable.includes(filters.topic.toLowerCase()))
      && (!query || searchable.includes(query));
  });
}

export function socialStatus(item: unknown, fallback = 'unknown'): unknown {
  const record = asRecord(item);
  const status = record.status ?? record.changeType;
  if (status !== undefined && status !== null && status !== '') return status;
  const sentiment = asRecord(record.sentiment);
  if (sentiment.status !== undefined && sentiment.status !== null && sentiment.status !== '') return sentiment.status;
  return fallback;
}

export function socialSentiment(item: unknown, fallback = '未提供'): string {
  const record = asRecord(item);
  const raw = record.sentiment ?? record.sentimentLabel;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const sentiment = asRecord(raw);
    return text(sentiment.label ?? sentiment.status ?? sentiment.value, fallback);
  }
  return text(raw, fallback);
}

export function socialAuthor(item: unknown, fallback = '作者未提供'): string {
  const record = asRecord(item);
  const rawAuthor = record.author;
  if (typeof rawAuthor === 'string' || typeof rawAuthor === 'number') return text(rawAuthor, fallback);
  const author = asRecord(rawAuthor);
  const account = asRecord(record.account);
  const name = text(author.name ?? author.displayName ?? account.name ?? account.displayName, '');
  const handle = text(author.handle ?? author.username ?? account.handle ?? account.username ?? record.accountHandle, '');
  if (name && handle && name !== handle) return `${name} · ${handle}`;
  return name || handle || fallback;
}

export function socialEngagement(item: unknown, fallback = '—'): string {
  const record = asRecord(item);
  const raw = record.engagement ?? record.engagementCount ?? asRecord(record.metrics).engagement;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return text(raw, fallback);
  const engagement = asRecord(raw);
  const total = engagement.total ?? engagement.totalCount ?? engagement.count ?? engagement.value;
  if (total !== undefined && total !== null && total !== '') return text(total, fallback);
  const parts = ['likes', 'comments', 'shares', 'replies', 'views']
    .map(key => engagement[key] === undefined ? '' : `${key} ${text(engagement[key], '—')}`)
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : fallback;
}

export function socialTopics(item: unknown, fallback = '未标注'): string {
  const record = asRecord(item);
  const raw = record.topics ?? record.tags ?? record.topic;
  if (Array.isArray(raw)) {
    const values = raw.map(entry => {
      if (typeof entry === 'string' || typeof entry === 'number') return text(entry, '');
      const topic = asRecord(entry);
      return text(topic.name ?? topic.label ?? topic.value, '');
    }).filter(Boolean);
    return values.length > 0 ? values.join('、') : fallback;
  }
  if (raw && typeof raw === 'object') {
    const topic = asRecord(raw);
    return text(topic.name ?? topic.label ?? topic.value, fallback);
  }
  return text(raw, fallback);
}

export function socialSourceLineage(item: unknown, fallback = '来源链路未提供'): string {
  const record = asRecord(item);
  const raw = record.sourceLineage ?? record.lineage ?? record.source;
  if (Array.isArray(raw)) {
    const values = raw.map(entry => typeof entry === 'string' ? entry : text(asRecord(entry).name ?? asRecord(entry).title ?? asRecord(entry).id, '')).filter(Boolean);
    if (values.length > 0) return values.join(' → ');
  }
  if (raw && typeof raw === 'object') {
    const source = asRecord(raw);
    const label = text(source.name ?? source.title ?? source.id, '');
    if (label) return label;
  }
  return text(raw, value(record, 'sourceUrl', fallback));
}

export function socialCanonicalUrl(item: unknown): string {
  const record = asRecord(item);
  return text(record.canonicalUrl ?? record.url ?? record.sourceUrl, '');
}

export function safeRemediationRoute(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '';
  const pathname = raw.split(/[?#]/, 1)[0];
  if (pathname === '/setup' || pathname === '/social' || /^\/social\/(streams|accounts|content|insights|alerts)$/.test(pathname)) return raw;
  if (/^\/settings\/(workspace|members|connections|execution|developer|audit)$/.test(pathname)) return raw;
  if (/^\/projects\/[^/]+\/(?:social(?:\/(streams|accounts|content|insights|alerts))?|orchestration|operations|data|delivery|settings)$/.test(pathname)) return raw;
  return '';
}

function booleanText(valueToRead: unknown, fallback = '未说明'): string {
  if (typeof valueToRead === 'boolean') return valueToRead ? '是' : '否';
  return text(valueToRead, fallback);
}

function field(record: JsonRecord, key: string): unknown {
  const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  return record[key] ?? record[snakeKey];
}

function stateText(record: JsonRecord, keys: string[], fallback: string): string {
  const sources = [record, asRecord(record.capabilityStatus ?? record.capabilities ?? record.capability ?? record.statuses)];
  for (const source of sources) {
    for (const key of keys) {
      const candidate = field(source, key);
      if (candidate !== undefined && candidate !== null && candidate !== '') return booleanText(candidate, fallback);
    }
  }
  return fallback;
}

export function SocialCapabilityBadges({ item }: { item: unknown }) {
  const record = asRecord(item);
  const config = asRecord(record.config);
  const configuredPlatforms = Array.isArray(config.platforms) ? config.platforms.filter(valueToRead => typeof valueToRead === 'string').join(', ') : '';
  const platform = stateText(record, ['platform', 'platformName', 'network'], configuredPlatforms || '未提供');
  const connection = stateText(record, ['connectionStatus', 'connectionState', 'connected'], '未检查');
  const authorization = stateText(record, ['authorizationStatus', 'authStatus', 'authorized'], '未检查');
  const experimental = stateText(record, ['experimental', 'isExperimental'], '未说明');
  return <div className="tb-social-badges" aria-label="平台能力状态"><span>平台 · {platform}</span><span>连接 · {connection}</span><span>授权 · {authorization}</span><span className="tb-social-experimental">实验性 · {experimental}</span></div>;
}

export function SocialFilterBar({ filters, onChange, includeSentiment = false, includeSeverity = false, includeTopic = false, includeStatus = true }: { filters: SocialFilters; onChange: (next: SocialFilters) => void; includeSentiment?: boolean; includeSeverity?: boolean; includeTopic?: boolean; includeStatus?: boolean }) {
  function update(key: keyof SocialFilters, valueToSet: string) {
    onChange({ ...filters, [key]: valueToSet || undefined });
  }
  function clear() {
    onChange({});
  }
  return <div className="tb-social-filters" role="search" aria-label="社媒筛选"><label>平台<select value={filters.platform ?? ''} onChange={event => update('platform', event.target.value)}><option value="">全部平台</option><option value="bluesky">Bluesky</option><option value="reddit">Reddit</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="opencli">OpenCLI</option><option value="x" disabled title="当前没有原生 X provider">X（未连接/不可用）</option><option value="other">其他</option></select></label>{includeStatus && <label>状态<select value={filters.status ?? ''} onChange={event => update('status', event.target.value)}><option value="">全部状态</option><option value="all">全部（含已解决）</option><option value="active">活跃</option><option value="running">运行中</option><option value="paused">已暂停</option><option value="error">错误</option><option value="disabled">已禁用</option><option value="open">待处理</option><option value="blocked">阻塞</option><option value="failed">失败</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></select></label>}{includeSentiment && <label>情绪<select value={filters.sentiment ?? ''} onChange={event => update('sentiment', event.target.value)}><option value="">全部情绪</option><option value="positive">正向</option><option value="neutral">中性</option><option value="negative">负向</option><option value="mixed">混合</option></select></label>}{includeSeverity && <label>严重度<select value={filters.severity ?? ''} onChange={event => update('severity', event.target.value)}><option value="">全部严重度</option><option value="critical">严重</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>}{includeTopic && <label>话题<input value={filters.topic ?? ''} onChange={event => update('topic', event.target.value)} placeholder="筛选话题"/></label>}<label className="tb-social-filter-query">关键词<input value={filters.query ?? ''} onChange={event => update('query', event.target.value)} placeholder="搜索内容、作者或项目"/></label>{filters.platform?.toLowerCase() === 'opencli' && <small className="tb-social-filter-note">OpenCLI 按已配置站点前缀在样本中匹配；不会向后端发送裸平台值。</small>}{Object.values(filters).some(Boolean) && <button type="button" className="tb-button tb-button-secondary" onClick={clear}>清除筛选</button>}</div>;
}

export function SocialReadOnlyNote({ children = '这是只读监听面板，不提供自动发帖、评论或私信动作。' }: { children?: ReactNode }) {
  return <div className="tb-contract-note tb-social-readonly"><span>◎</span><p>{children}</p></div>;
}

type MonitorQuery = ReturnType<typeof useApiQuery<unknown>>;

export function MonitorManager({ projectId, query }: { projectId: string; query: MonitorQuery }) {
  const monitors = responseItems(query.data, 'monitors', 'items');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<unknown>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('new'); setError(null); setResult(null);
    const form = new FormData(event.currentTarget);
    try {
      const platform = String(form.get('platform') ?? '').trim();
      if (platform.toLowerCase() === 'opencli') throw new Error('OpenCLI 需要先配置具体项目来源，当前不能发送裸 opencli。');
      const intervalMinutes = Number(form.get('intervalMinutes') ?? 15);
      const response = await v2.createSocialMonitor(projectId, {
        name: String(form.get('name') ?? '').trim(),
        monitorType: 'keyword',
        platform,
        query: String(form.get('query') ?? '').trim(),
        config: { platforms: [platform] },
        intervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 15,
        enabled: true,
        status: 'active',
      });
      setResult(response); query.retry(); event.currentTarget.reset();
    } catch (reason) { setError(reason instanceof Error ? reason : new Error('创建社媒监控失败。')); }
    finally { setBusy(''); }
  }

  async function toggle(item: JsonRecord) {
    const id = pickId(item) || objectId(item);
    if (!id) return;
    const current = typeof item.enabled === 'boolean' ? item.enabled : ['active', 'running', 'enabled'].includes(String(item.status ?? '').toLowerCase());
    setBusy(id); setError(null); setResult(null);
    try {
      const revision = item.revision;
      setResult(await v2.updateSocialMonitor(projectId, id, {
        enabled: !current,
        status: current ? 'paused' : 'active',
        ...(revision === undefined || revision === null ? {} : { revision }),
      }));
      query.retry();
    } catch (reason) { setError(reason instanceof Error ? reason : new Error('更新社媒监控失败。')); }
    finally { setBusy(''); }
  }

  return <section className="tb-card tb-social-monitor-card"><header className="tb-card-header"><div><p className="tb-eyebrow">MONITORS / READ-ONLY LISTENING</p><h2>项目监控</h2><p>监控只读取公开内容或明确授权的数据，不触发平台写操作。</p></div><span className="tb-count-pill">{monitors.length} 个</span></header>{error && <div className="tb-form-error" role="alert"><strong>监控操作未完成</strong><span>{error.message}</span></div>}<DataState loading={query.loading} error={query.error} retry={query.retry} empty={<EmptyState title="暂无监控" description="创建一个平台与关键词监控后，内容会按项目归档。"/>}>{monitors.length === 0 ? <EmptyState title="暂无监控" description="v2 返回空列表，创建一个监听范围开始观察。"/> : <div className="tb-social-monitor-list">{monitors.map((item, index) => {const id = pickId(item) || objectId(item); const enabled = typeof item.enabled === 'boolean' ? item.enabled : ['active', 'running', 'enabled'].includes(String(item.status ?? '').toLowerCase()); return <article key={id || index}><div className="tb-social-monitor-icon">◎</div><div><strong>{value(item, 'name', value(item, 'query', `监控 ${index + 1}`))}</strong><p>{value(item, 'query', value(item, 'keywords', '关键词未提供'))} · {value(item, 'projectName', projectId)}</p><small>最近采集 {value(item, 'lastCollectedAt', value(item, 'updatedAt', '时间未提供'))}</small><SocialCapabilityBadges item={item}/></div><StatusBadge value={item.status ?? (enabled ? 'active' : 'paused')}/><button type="button" className="tb-button tb-button-secondary" onClick={() => void toggle(item)} disabled={busy === id || !id}>{busy === id ? '保存中…' : enabled ? '暂停' : '启用'}</button></article>})}</div>}</DataState><form className="tb-social-monitor-form" onSubmit={create}><h3>新建只读监控</h3><p className="tb-social-form-note">OpenCLI 需要先在项目数据源配置中选择具体站点；当前没有动态 capability 列表，因此不发送裸 <code>opencli</code>。</p><div><label>名称<input name="name" required maxLength={100} placeholder="例如：竞品发布追踪"/></label><label>平台<select name="platform" required defaultValue="bluesky"><option value="bluesky">Bluesky</option><option value="reddit">Reddit</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="opencli" disabled title="请先配置项目数据源">OpenCLI（需项目来源配置）</option></select></label><label className="tb-social-query-field">关键词 / 主题<input name="query" required maxLength={500} placeholder="例如：AI coding assistant"/></label><label>采集间隔（分钟）<input name="intervalMinutes" type="number" min="1" max="1440" defaultValue="15"/></label></div><button type="submit" className="tb-button tb-button-primary" disabled={busy === 'new'}>{busy === 'new' ? '创建中…' : '创建监控'}</button></form>{result !== null && <JsonDetails value={result} label="查看最近监控响应"/>}<SocialReadOnlyNote/></section>;
}
