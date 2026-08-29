'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

type Job = {
  id: string; platform: string; keyword: string; limit: number; status: string; progress: number;
  attempt: number; max_attempts: number; last_error: string | null; created_at: string;
};
type Node = {
  id: string; name: string; platform: string; version: string; max_concurrency: number;
  active_jobs: number; status: string; last_seen_at: string; capabilities_json: string;
  runtime_json: string; health_json: string;
};
type Report = {
  id: string; job_id: string; platform: string; keyword: string; item_count: number;
  pain_point_count: number; generated_at: string;
};
type Schedule = {
  id: string; name: string; platform: string; keyword: string; limit: number;
  interval_minutes: number; schedule_type?:'interval'|'cron'; cron_expression?:string|null; timezone?:string|null;
  enabled: number; last_run_at: string | null; next_run_at: string;
};
type RecordItem = {
  id: string; platform: string; source_item_id: string; item_type: string; title: string | null;
  content: string; author: string | null; url: string | null; observed_at: string;
  metrics_json: string; raw_json: string; last_seen_at: string; duplicate_count: number;
};
type PlatformCatalogItem = { id:string;onlineNodes:number;availableSlots:number;status:string };
type JobEvent = { id:string;job_id:string;type:string;message:string;created_at:string };
type Data = {
  metrics: { runningJobs:number; queuedJobs:number; completedToday:number; itemsToday:number; onlineNodes:number; totalNodes:number; availableSlots:number; successRate:number; recordsTotal:number; activeSchedules:number };
  jobs: Job[]; nodes: Node[]; reports: Report[]; schedules: Schedule[]; records: RecordItem[];
};

const emptyData: Data = {
  metrics: { runningJobs:0, queuedJobs:0, completedToday:0, itemsToday:0, onlineNodes:0, totalNodes:0, availableSlots:0, successRate:100, recordsTotal:0, activeSchedules:0 },
  jobs: [], nodes: [], reports: [], schedules: [], records: [],
};
const platformNames: Record<string, string> = {
  geo:'GEO 官网观测',
  bluesky:'Bluesky', reddit:'Reddit', youtube:'YouTube', tiktok:'TikTok', douyin:'抖音', xiaohongshu:'小红书',
  'opencli:bilibili':'Bilibili', 'opencli:zhihu':'知乎', 'opencli:weibo':'微博', 'opencli:twitter':'X / Twitter',
  'opencli:linkedin':'LinkedIn', 'opencli:hackernews':'Hacker News', 'opencli:xueqiu':'雪球', 'opencli:eastmoney':'东方财富',
};
const statusNames: Record<string, string> = { queued:'等待节点', running:'运行中', completed:'已完成', failed:'失败', cancelled:'已取消' };

function platformName(platform: string) {
  if (platformNames[platform]) return platformNames[platform];
  return platform.startsWith('opencli:') ? platform.slice(8) : platform;
}

function platformClass(platform: string) {
  return platform.startsWith('opencli:') ? 'opencli' : platform;
}

function capabilitiesOf(node: Node): string[] {
  try {
    const parsed = JSON.parse(node.capabilities_json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function nodeRuntime(node: Node): { profile: string; transport: string; state: string } {
  try {
    const runtime = JSON.parse(node.runtime_json) as Record<string, unknown>;
    const health = JSON.parse(node.health_json) as Record<string, unknown>;
    return {
      profile: typeof runtime['browserProfile'] === 'string' ? runtime['browserProfile'] : 'default',
      transport: runtime['transport'] === 'outbound-polling' ? '出站轮询' : 'Worker',
      state: typeof health['state'] === 'string' ? health['state'] : 'unknown',
    };
  } catch {
    return { profile: 'default', transport: 'Worker', state: 'unknown' };
  }
}

function formatCount(value: number) {
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}k` : value.toLocaleString('zh-CN');
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未执行';
}

export function DashboardClient({ user }: { user: { displayName: string; email: string } }) {
  const [data, setData] = useState<Data>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createPlatform, setCreatePlatform] = useState('bluesky');
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleMode,setScheduleMode]=useState<'interval'|'cron'>('interval');
  const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null);
  const [recordResults, setRecordResults] = useState<RecordItem[] | null>(null);
  const [recordTotal, setRecordTotal] = useState<number | null>(null);
  const [recordFilter, setRecordFilter] = useState({ search:'', platform:'' });
  const [catalogPlatforms, setCatalogPlatforms] = useState<PlatformCatalogItem[]>([]);
  const [traceJob, setTraceJob] = useState<Job | null>(null);
  const [traceEvents, setTraceEvents] = useState<JobEvent[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const workerCapabilities = useMemo(() => [
    ...new Set(data.nodes.flatMap(capabilitiesOf)),
  ].sort((a,b) => platformName(a).localeCompare(platformName(b), 'zh-CN')), [data.nodes]);
  const platformOptions = useMemo(() => [
    ...new Set([...Object.keys(platformNames), ...catalogPlatforms.map(item=>item.id), ...workerCapabilities]),
  ].sort((a,b) => platformName(a).localeCompare(platformName(b), 'zh-CN')), [catalogPlatforms,workerCapabilities]);
  const shownRecords = recordResults ?? data.records;
  const shownRecordTotal = recordTotal ?? data.metrics.recordsTotal;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      const body = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(body.error ?? '加载控制平面失败');
      setData(body);
      try{const catalogResponse=await fetch('/api/platforms',{cache:'no-store'});if(catalogResponse.ok){const catalog=await catalogResponse.json() as {platforms?:PlatformCatalogItem[]};setCatalogPlatforms(catalog.platforms??[]);}}catch{/* 目录加载失败时继续使用 Worker 能力与内置目录 */}
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载控制平面失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const opencliCommand = String(form.get('opencliCommand') ?? '').trim();
    const opencliArgs = String(form.get('opencliArgs') ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: form.get('platform'), keyword: form.get('keyword'), limit: Number(form.get('limit')),
          includeComments: form.get('includeComments') === 'on',
          ...(opencliCommand ? { opencliCommand, opencliArgs } : {}),
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '创建任务失败');
      setShowCreate(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建任务失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const opencliCommand = String(form.get('opencliCommand') ?? '').trim();
    const opencliArgs = String(form.get('opencliArgs') ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    try {
      const response = await fetch('/api/schedules', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'), platform: form.get('platform'), keyword: form.get('keyword'),
          limit: Number(form.get('limit')), mode:scheduleMode,scheduleType:scheduleMode,
          ...(scheduleMode==='interval'?{intervalMinutes:Number(form.get('intervalMinutes'))}:{cronExpression:String(form.get('cronExpression')??''),timezone:String(form.get('timezone')??'Asia/Shanghai')}),
          includeComments: form.get('includeComments') === 'on',
          runImmediately: form.get('runImmediately') === 'on',
          ...(opencliCommand ? { opencliCommand, opencliArgs } : {}),
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '创建定时计划失败');
      setShowSchedule(false);setScheduleMode('interval');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建定时计划失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function scheduleAction(schedule: Schedule, action: 'pause' | 'resume' | 'run') {
    try {
      const response = await fetch(`/api/schedules/${schedule.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '操作定时计划失败');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作定时计划失败');
    }
  }

  async function searchRecords(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    const search = String(form.get('search') ?? '').trim();
    const platform = String(form.get('platform') ?? '').trim();
    if (search) params.set('search', search);
    if (platform) params.set('platform', platform);
    setRecordFilter({search,platform});
    try {
      const response = await fetch(`/api/records?${params}`, { cache: 'no-store' });
      const body = await response.json() as { records?: RecordItem[]; total?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? '搜索数据记录失败');
      setRecordResults(body.records ?? []);
      setRecordTotal(body.total ?? 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '搜索数据记录失败');
    }
  }

  async function act(job: Job, action: 'cancel' | 'retry') {
    try {
      const response = await fetch(`/api/jobs/${job.id}`, { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({ action }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '操作失败');
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
  }
  async function viewTrace(job:Job){setTraceJob(job);setTraceLoading(true);setTraceEvents([]);try{const response=await fetch(`/api/jobs/${job.id}/events?limit=200`,{cache:'no-store'});const body=await response.json() as {events?:JobEvent[];error?:string};if(!response.ok)throw new Error(body.error??'加载事件失败');setTraceEvents(body.events??[]);}catch(reason){setError(reason instanceof Error?reason.message:'加载事件失败');}finally{setTraceLoading(false);}}
  function exportUrl(format:'csv'|'json'){const params=new URLSearchParams({format});if(recordFilter.search)params.set('search',recordFilter.search);if(recordFilter.platform)params.set('platform',recordFilter.platform);return`/api/exports?${params}`;}

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">采</span><span><strong>ThreadBeacon</strong><small>Control plane</small></span></div>
        <nav aria-label="主导航">
          <a className="nav-item active" href="#overview"><span>⌁</span>总览</a>
          <a className="nav-item" href="#jobs"><span>◫</span>采集任务</a>
          <a className="nav-item" href="#schedules"><span>◷</span>定时计划</a>
          <a className="nav-item" href="#records"><span>▦</span>数据记录</a>
          <a className="nav-item" href="#sources"><span>◎</span>数据源</a>
          <a className="nav-item" href="#nodes"><span>⌘</span>执行节点</a>
          <a className="nav-item" href="#reports"><span>▤</span>分析报告</a>
          <a className="nav-item" href="/studio"><span>⌘</span>工作流与治理</a>
          <a className="nav-item" href="/skills"><span>◈</span>Skill 治理</a>
        </nav>
        <div className="sidebar-foot"><span className="system-dot" /><span><strong>{error ? '连接异常' : '系统正常'}</strong><small>{loading ? '正在同步状态' : '控制平面已连接'}</small></span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">运营工作台</p><h1>数据采集控制中心</h1></div>
          <div className="top-actions">
            <button className="ghost-button" type="button" aria-label="刷新" onClick={() => void refresh()}>↻</button>
            <div className="user-chip"><span className="avatar">{user.displayName.slice(0,1).toUpperCase()}</span><span><strong>{user.displayName}</strong><small>{user.email}</small></span></div>
            <button className="primary-button" type="button" onClick={() => setShowCreate(true)}><span>＋</span>新建采集任务</button>
          </div>
        </header>

        <div className="content" id="overview">
          {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
          <section className="hero-panel">
            <div><span className="live-pill"><i />实时运行</span><h2>今天已采集 <em>{formatCount(data.metrics.itemsToday)}</em> 条公开内容</h2><p>{data.metrics.onlineNodes} 个执行节点在线，{data.metrics.queuedJobs} 个任务正在等待。管理台每 5 秒自动同步最新状态。</p></div>
            <div className="hero-chart" aria-label="系统运行趋势">{[38,52,44,67,59,82,74,91,86,100].map((height,i)=><span key={i} style={{height:`${Math.max(12,height-data.metrics.queuedJobs*2)}%`}} />)}</div>
          </section>

          <section className="metrics" aria-label="关键指标">
            <article><span className="metric-icon violet">◫</span><div><small>进行中任务</small><strong>{data.metrics.runningJobs}</strong><p><b>{data.metrics.queuedJobs}</b> 个等待执行</p></div></article>
            <article><span className="metric-icon cyan">◉</span><div><small>数据资产</small><strong>{formatCount(data.metrics.recordsTotal)}</strong><p><b>{formatCount(data.metrics.itemsToday)}</b> 条今日采集</p></div></article>
            <article><span className="metric-icon green">⌘</span><div><small>在线节点</small><strong>{data.metrics.onlineNodes} / {data.metrics.totalNodes}</strong><p><b>{data.metrics.availableSlots}</b> 个可用槽位</p></div></article>
            <article><span className="metric-icon amber">◷</span><div><small>运行计划</small><strong>{data.metrics.activeSchedules}</strong><p><b>{data.metrics.successRate}%</b> 累计成功率</p></div></article>
          </section>

          <div className="dashboard-grid">
            <section className="panel jobs-panel" id="jobs">
              <div className="panel-head"><div><h3>最近任务</h3><p>跨平台采集与分析流水线</p></div><button className="text-button" onClick={() => setShowCreate(true)}>新建任务 ＋</button></div>
              <div className="job-list">
                {data.jobs.length === 0 && <div className="empty-state"><strong>还没有采集任务</strong><p>创建第一条任务后，在线 Worker 会自动领取并执行。</p></div>}
                {data.jobs.map(job => <article className="job-row" key={job.id}>
                  <span className={`source-logo source-${platformClass(job.platform)}`}>{platformName(job.platform).slice(0,1)}</span>
                  <div className="job-copy"><strong>{job.keyword}</strong><small>{platformName(job.platform)} · 上限 {job.limit} 条 · 尝试 {job.attempt}/{job.max_attempts}</small>{job.last_error && <small className="job-error">{job.last_error}</small>}</div>
                  <div className="progress"><span><i style={{width:`${job.progress}%`}} /></span><small>{job.progress}%</small></div>
                  <span className={`status ${job.status}`}><i />{statusNames[job.status] ?? job.status}</span>
                  <div className="row-actions"><button aria-label="查看事件 Trace" title="事件 Trace" onClick={() => void viewTrace(job)}>⋯</button>{['queued','running'].includes(job.status) && <button aria-label="取消任务" onClick={() => void act(job,'cancel')}>×</button>}{['failed','cancelled'].includes(job.status) && <button aria-label="重试任务" onClick={() => void act(job,'retry')}>↻</button>}</div>
                </article>)}
              </div>
            </section>

            <section className="panel nodes-panel" id="nodes">
              <div className="panel-head"><div><h3>执行节点</h3><p>分布式 Worker 状态</p></div><span className="count-label">{data.metrics.onlineNodes} 在线</span></div>
              <div className="node-list">
                {data.nodes.length === 0 && <div className="empty-state compact"><strong>暂无执行节点</strong><p>运行 worker:register 注册。</p></div>}
                {data.nodes.map(node => { const runtime=nodeRuntime(node); return <article key={node.id}><span className="node-icon">⌘</span><div><strong>{node.name}</strong><small>{node.platform} · v{node.version}</small><small>{runtime.transport} · 浏览器配置 {runtime.profile}</small></div><div className="node-state"><span className={node.status}><i />{node.status === 'online' ? '在线' : '离线'}</span><small>{node.active_jobs} / {node.max_concurrency} · {runtime.state}</small></div></article>; })}
              </div>
            </section>
          </div>

          <div className="automation-grid">
            <section className="panel schedules-panel" id="schedules">
              <div className="panel-head"><div><h3>定时计划</h3><p>Worker 轮询时自动生成到期任务，不堆积错过的历史周期</p></div><button className="text-button" onClick={() => setShowSchedule(true)}>新建计划 ＋</button></div>
              <div className="schedule-list">
                {data.schedules.length === 0 && <div className="empty-state compact"><strong>暂无定时计划</strong><p>创建计划后可立即运行，也可按周期自动入队。</p></div>}
                {data.schedules.map(schedule => <article key={schedule.id}>
                  <span className={`source-logo source-${platformClass(schedule.platform)}`}>{platformName(schedule.platform).slice(0,1)}</span>
                  <div><strong>{schedule.name}</strong><small>{platformName(schedule.platform)} · {schedule.keyword} · {schedule.schedule_type==='cron'||schedule.cron_expression?`Cron ${schedule.cron_expression} · ${schedule.timezone??'UTC'}`:`每 ${schedule.interval_minutes} 分钟`}</small><small>下次：{schedule.enabled ? formatDate(schedule.next_run_at) : '已暂停'}</small></div>
                  <span className={`schedule-state ${schedule.enabled ? 'enabled' : 'paused'}`}>{schedule.enabled ? '运行中' : '已暂停'}</span>
                  <div className="schedule-actions">{Boolean(schedule.enabled) && <button onClick={() => void scheduleAction(schedule,'run')}>立即</button>}<button onClick={() => void scheduleAction(schedule,schedule.enabled ? 'pause' : 'resume')}>{schedule.enabled ? '暂停' : '恢复'}</button></div>
                </article>)}
              </div>
            </section>

            <section className="panel records-panel" id="records">
              <div className="panel-head"><div><h3>数据记录</h3><p>{shownRecordTotal.toLocaleString('zh-CN')} 条唯一记录，重复采集自动合并</p></div><div className="export-actions"><a href={exportUrl('csv')} download>导出 CSV</a><a href={exportUrl('json')} download>导出 JSON</a></div></div>
              <form className="record-filters" onSubmit={searchRecords}><input name="search" placeholder="搜索标题、正文或作者" /><select name="platform" defaultValue=""><option value="">全部平台</option>{platformOptions.map(id=><option key={id} value={id}>{platformName(id)}</option>)}</select><button>搜索</button>{recordResults && <button type="button" className="clear-filter" onClick={() => { setRecordResults(null); setRecordTotal(null); setRecordFilter({search:'',platform:''}); }}>清除</button>}</form>
              <div className="record-list">
                {shownRecords.length === 0 && <div className="empty-state compact"><strong>暂无数据记录</strong><p>任务完成后，标准化内容会自动进入记录中心。</p></div>}
                {shownRecords.map(record => <button type="button" key={record.id} onClick={() => setSelectedRecord(record)}><span className={`source-logo source-${platformClass(record.platform)}`}>{platformName(record.platform).slice(0,1)}</span><span><strong>{record.title ?? record.content.slice(0,80)}</strong><small>{platformName(record.platform)} · {record.author ?? '未知作者'} · {formatDate(record.observed_at)}</small></span><b>{record.duplicate_count ? `重复 ${record.duplicate_count}` : '新记录'}</b></button>)}
              </div>
            </section>
          </div>

          <div className="secondary-grid">
            <section className="panel" id="sources"><div className="panel-head"><div><h3>数据源能力</h3><p>在线 Worker 上报 {workerCapabilities.length} 个；任务目录共 {platformOptions.length} 个平台</p></div></div><div className="source-grid">{platformOptions.slice(0,18).map(id=><div key={id}><span className={`source-logo source-${platformClass(id)}`}>{platformName(id).slice(0,1)}</span><span><strong>{platformName(id)}</strong><small>{workerCapabilities.includes(id) ? '节点可用' : '等待节点'}</small></span></div>)}</div>{platformOptions.length > 18 && <details className="catalog-details"><summary>查看全部 {platformOptions.length} 个平台</summary><div>{platformOptions.map(id=><code key={id}>{platformName(id)}</code>)}</div></details>}</section>
            <section className="panel" id="reports"><div className="panel-head"><div><h3>最新报告</h3><p>完整 JSON 报告存储在私有对象存储</p></div></div><div className="report-list">{data.reports.length === 0 && <div className="empty-state compact"><strong>暂无报告</strong><p>任务完成后会自动出现在这里。</p></div>}{data.reports.map(report=><a key={report.id} href={`/api/reports/${report.id}`}><span>▤</span><div><strong>{report.keyword}</strong><small>{platformName(report.platform)} · {report.item_count} 条 · {report.pain_point_count} 个痛点</small></div><b>下载</b></a>)}</div></section>
          </div>
        </div>
      </section>

      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title" onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">New collection</p><h2 id="create-title">新建采集任务</h2></div><button aria-label="关闭" onClick={() => setShowCreate(false)}>×</button></div><form onSubmit={createJob}><label>数据平台<input name="platform" list="platform-options" value={createPlatform} onChange={event=>setCreatePlatform(event.target.value)} required pattern="[a-z0-9:._-]+" /><datalist id="platform-options">{platformOptions.map(id=><option key={id} value={id}>{platformName(id)}</option>)}</datalist></label><label>{createPlatform==='geo'?'公开官网 URL':'搜索关键词'}<input name="keyword" type={createPlatform==='geo'?'url':'text'} required maxLength={200} placeholder={createPlatform==='geo'?'https://example.com/':'例如：AI coding assistant'} /></label>{createPlatform==='geo'?<><input name="limit" type="hidden" value="1"/><p className="form-hint">执行 official-site.observe@1.0.0：只允许匿名浏览器 Profile，检查 SSRF 与 robots.txt，并拒绝保存个性化页面。</p></>:<><label>采集上限<input name="limit" type="number" min={1} max={1000} defaultValue={100} /></label><label className="check-label"><input name="includeComments" type="checkbox" defaultChecked />同时采集评论/回复</label></>}<details className="advanced-options"><summary>OpenCLI 高级参数（可选）</summary><label>只读命令<input name="opencliCommand" placeholder="默认自动选择 search / hot / feed" disabled={createPlatform==='geo'} /></label><label>命令参数（每行一项）<textarea name="opencliArgs" rows={4} placeholder={'参数值\n--limit\n20'} disabled={createPlatform==='geo'} /></label><p>{createPlatform==='geo'?'GEO 使用固定、版本化的能力契约，不接受任意命令。':'仅用于 opencli: 平台；写操作、下载、敏感字段和输出路径会被 Worker 拒绝。'}</p></details><div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setShowCreate(false)}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? '创建中…' : '进入任务队列'}</button></div></form></section></div>}
      {showSchedule && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowSchedule(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-title" onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Automation</p><h2 id="schedule-title">新建定时计划</h2></div><button aria-label="关闭" onClick={() => setShowSchedule(false)}>×</button></div><form onSubmit={createSchedule}><label>计划名称<input name="name" required maxLength={80} placeholder="例如：每日 AI 舆情追踪" /></label><label>数据平台<input name="platform" list="platform-options" defaultValue="opencli:hackernews" required pattern="[a-z0-9:._-]+" /></label><label>搜索关键词<input name="keyword" required maxLength={200} /></label><label>计划模式<select value={scheduleMode} onChange={event=>setScheduleMode(event.target.value as 'interval'|'cron')}><option value="interval">固定间隔</option><option value="cron">Cron 表达式</option></select></label>{scheduleMode==='interval'?<label>执行频率<select name="intervalMinutes" defaultValue="60"><option value="15">每 15 分钟</option><option value="30">每 30 分钟</option><option value="60">每小时</option><option value="360">每 6 小时</option><option value="720">每 12 小时</option><option value="1440">每天</option><option value="10080">每周</option></select></label>:<><label>Cron 表达式<input name="cronExpression" required placeholder="0 9 * * 1-5" pattern="[^\n\r]+"/><small>标准五段 Cron，例如工作日 09:00。</small></label><label>时区<input name="timezone" required defaultValue="Asia/Shanghai" placeholder="Asia/Shanghai"/></label></>}<label>每次采集上限<input name="limit" type="number" min={1} max={1000} defaultValue={100} /></label><label className="check-label"><input name="includeComments" type="checkbox" defaultChecked />同时采集评论/回复</label><label className="check-label"><input name="runImmediately" type="checkbox" defaultChecked />创建后立即执行一次</label><details className="advanced-options"><summary>OpenCLI 高级参数（可选）</summary><label>只读命令<input name="opencliCommand" placeholder="默认自动选择 search / hot / feed" /></label><label>命令参数（每行一项）<textarea name="opencliArgs" rows={3} /></label></details><div className="modal-actions"><button type="button" className="cancel-button" onClick={() => {setShowSchedule(false);setScheduleMode('interval')}}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? '创建中…' : '启用计划'}</button></div></form></section></div>}
      {selectedRecord && <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedRecord(null)}><section className="modal record-modal" role="dialog" aria-modal="true" aria-labelledby="record-title" onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Collected record</p><h2 id="record-title">{selectedRecord.title ?? '数据记录详情'}</h2></div><button aria-label="关闭" onClick={() => setSelectedRecord(null)}>×</button></div><dl><div><dt>平台</dt><dd>{platformName(selectedRecord.platform)}</dd></div><div><dt>作者</dt><dd>{selectedRecord.author ?? '未知'}</dd></div><div><dt>来源标识</dt><dd>{selectedRecord.source_item_id}</dd></div><div><dt>观测时间</dt><dd>{formatDate(selectedRecord.observed_at)}</dd></div><div><dt>重复次数</dt><dd>{selectedRecord.duplicate_count}</dd></div></dl><p className="record-content">{selectedRecord.content}</p>{selectedRecord.url && <a className="record-link" href={selectedRecord.url} target="_blank" rel="noreferrer">打开原始内容 ↗</a>}<details className="raw-record"><summary>查看原始 JSON</summary><pre>{JSON.stringify(JSON.parse(selectedRecord.raw_json), null, 2)}</pre></details></section></div>}
      {traceJob&&<div className="modal-backdrop" role="presentation" onMouseDown={()=>setTraceJob(null)}><section className="modal trace-modal" role="dialog" aria-modal="true" aria-labelledby="trace-title" onMouseDown={event=>event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">JOB EVENT TRACE</p><h2 id="trace-title">{traceJob.keyword}</h2><small>{platformName(traceJob.platform)} · {traceJob.id}</small></div><button aria-label="关闭" onClick={()=>setTraceJob(null)}>×</button></div><div className="trace-timeline">{traceLoading&&<p>正在加载事件…</p>}{!traceLoading&&!traceEvents.length&&<p>该任务还没有事件。</p>}{traceEvents.map(event=><article key={event.id}><i/><div><strong>{event.type}</strong><p>{event.message}</p><time>{formatDate(event.created_at)}</time></div></article>)}</div></section></div>}
    </main>
  );
}
