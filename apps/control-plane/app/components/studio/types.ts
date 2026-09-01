export type Project = { id: string; name: string; description: string; template: string; status: string; updated_at: string };
export type Template = { id: string; name: string; description: string };
export type WorkflowNode = { id: string; type: NodeType; label: string; x: number; y: number; config: Record<string, unknown> };
export type WorkflowEdge = { id: string; source: string; target: string };
export type SourceSpec = { platform: string; keyword: string; limit: number; includeComments: boolean; projectSourceId?: string };
export type WorkflowSpec = { source: SourceSpec; sources?: SourceSpec[]; steps: string[]; nodes: WorkflowNode[]; edges: WorkflowEdge[] };
export type Workflow = { id: string; project_id: string | null; name: string; description: string; draft_json: string; revision: number; published_version: number; updated_at: string };
export type Run = { id: string; workflow_id: string; workflow_name: string; project_name: string | null; version: number; status: string; started_at: string; finished_at: string | null; job_id: string };
export type EventItem = { id: string; run_id: string; node_id: string; type: string; message: string; created_at: string };
export type Checkpoint = { id: string; run_id: string; node_id: string; status: string; started_at: string | null; finished_at: string | null };
export type Evidence = {
  id: string;
  project_id?: string | null;
  theme: string;
  summary: string;
  severity: number;
  source_count: number;
  linked_count: number;
  uncertainties_json?: string;
  review_status: 'pending' | 'approved' | 'rejected' | string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_rationale?: string;
  created_at: string;
};
export type EvidenceLink = { id: string; evidence_id: string; theme: string; title: string | null; author: string | null; platform: string; url: string | null };
export type Relationship = { id: string; source_title: string | null; target_title: string | null; relation: string; confidence: number };
export type ProjectSource = { id: string; project_id: string; name: string; kind: string; status: string; config_json: string; cursor_json?: string | null; last_success_at?: string | null; last_job_id?: string | null; consecutive_failures?: number | null; last_error?: string | null };
export type Plugin = { id: string; plugin_key: string; name: string; kind: string; version: string; status: string; capabilities_json: string };
export type Profile = { id: string; name: string; profile_name: string; mode: string; status: string; profile_kind?: 'anonymous' | 'authenticated'; node_id: string | null; site_bindings_json: string; attestation_json?: string; last_verified_at?: string | null; no_vnc_url?: string | null; cdp_url?: string | null; noVncUrl?: string | null; cdpUrl?: string | null };
export type WorkerNode = { id: string; name: string; platform: string; version: string; status: string; active_jobs: number; max_concurrency: number; runtime_json: string; health_json: string; capabilities_json: string; last_seen_at: string };
export type Rule = { id: string; project_id?: string | null; name: string; kind: string; enabled: number; created_at: string };
export type Audit = { id: string; action: string; resource_type: string; created_at: string };
export type Workspace = { id: string; name: string; role: string };
export type WebhookTrigger = { id: string; project_id?: string; workflow_id: string; name: string; enabled: number | boolean; created_at?: string; last_triggered_at?: string | null };
export type ApiToken = { id: string; name: string; role?: string; scopes_json?: string; token_prefix?: string; created_at?: string; expires_at?: string | null; last_used_at?: string | null; revoked_at?: string | null };
export type SkillOption = { id: string; name: string; domain: string; capability: string; current_version: number; status: string };
export type BrowserSession = { id: string; profile_id: string; node_id: string; status: string; target_id: string | null; allowlist_json: string; timeout_ms: number; capability: string; last_error: string | null; created_at: string; expires_at: string };
export type BrowserAction = { id: string; session_id: string; node_id: string; type: string; status: string; result_json: string | null; error: string | null; screenshot_key: string | null; created_at: string; finished_at: string | null };

export type StudioData = {
  workspace: Workspace | null;
  templates: Template[];
  projects: Project[];
  sources: ProjectSource[];
  workflows: Workflow[];
  runs: Run[];
  events: EventItem[];
  checkpoints: Checkpoint[];
  evidence: Evidence[];
  evidenceLinks: EvidenceLink[];
  relationships: Relationship[];
  plugins: Plugin[];
  profiles: Profile[];
  nodes: WorkerNode[];
  rules: Rule[];
  auditLogs: Audit[];
  skills: SkillOption[];
  deliveryLogs: Array<{ id: string; status: string; response_code: number | null; created_at: string }>;
  productMetrics?: { funnel: Record<string, number>; events: Array<{ event_name: string; count: number; last_at: string }> };
};

export type NodeType = 'source' | 'normalize' | 'dedupe' | 'filter' | 'gate' | 'cluster' | 'llm' | 'agent' | 'report' | 'dataset' | 'deliver';
export type Tab = 'projects' | 'workflow' | 'runs' | 'evidence' | 'resources' | 'plugins' | 'delivery';

export const platforms: Record<string, string> = {
  geo: 'GEO 官网观测',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  douyin: '抖音',
  xiaohongshu: '小红书',
  rss: 'RSS / Atom',
  rest: 'REST API',
  web: '公开网页',
  'opencli:hackernews': 'Hacker News',
  'opencli:zhihu': '知乎',
  'opencli:bilibili': 'Bilibili',
  'opencli:weibo': '微博',
  'opencli:twitter': 'X / Twitter',
  'opencli:linkedin': 'LinkedIn',
  'opencli:xueqiu': '雪球',
  'opencli:eastmoney': '东方财富',
};

export const nodeMeta: Record<NodeType, { label: string; icon: string; copy: string }> = {
  source: { label: '采集来源', icon: '◎', copy: '可并行的项目来源或平台' },
  normalize: { label: '数据归一化', icon: '≋', copy: '统一字段、语言与时间' },
  dedupe: { label: '跨任务去重', icon: '◇', copy: '来源 ID 与内容指纹合并' },
  filter: { label: '条件过滤', icon: '⌁', copy: '按字段或表达式筛选记录' },
  gate: { label: '质量闸门', icon: '⊢', copy: '不满足阈值时停止或跳过' },
  cluster: { label: '语义聚类', icon: '⌘', copy: '发现相似主题' },
  llm: { label: 'AI 研究', icon: '✦', copy: '摘要、标签与严重度' },
  agent: { label: 'Agent 节点', icon: '◈', copy: '受限工具与多步研究' },
  report: { label: '证据报告', icon: '▤', copy: '记录、证据与血缘' },
  dataset: { label: '数据集写入', icon: '▧', copy: '追加或覆盖结构化数据集' },
  deliver: { label: '自动交付', icon: '↗', copy: 'Webhook、消息与邮件网关' },
};

export const tabs: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'projects', label: '项目概览', icon: '▦' },
  { id: 'workflow', label: '研究流程', icon: '⌘' },
  { id: 'runs', label: '运行记录', icon: '◉' },
  { id: 'evidence', label: '结果与证据', icon: '⟠' },
  { id: 'resources', label: '团队与系统', icon: '▣' },
  { id: 'plugins', label: '开发者接口', icon: '◆' },
  { id: 'delivery', label: '自动交付', icon: '✓' },
];

export function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

export function safeProfileUrl(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password) return '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}
