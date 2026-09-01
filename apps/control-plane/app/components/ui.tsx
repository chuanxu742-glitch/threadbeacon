import type { ReactNode } from 'react';
import { Link } from '../routes/router.js';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="tb-page-header"><div><p className="tb-eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="tb-page-description">{description}</p>}</div>{actions && <div className="tb-page-actions">{actions}</div>}</header>;
}

export function MetricCard({ label, value, caption, tone = 'blue' }: { label: string; value: string; caption?: string; tone?: 'blue' | 'green' | 'amber' | 'red' }) {
  return <article className={`tb-metric tb-tone-${tone}`}><span>{label}</span><strong>{value}</strong>{caption && <small>{caption}</small>}</article>;
}

export function StatusBadge({ value }: { value: unknown }) {
  const status = typeof value === 'string' && value.trim() ? value : 'unknown';
  const labels: Record<string, string> = { ready: '就绪', succeeded: '成功', success: '成功', running: '运行中', queued: '排队中', pending: '待处理', blocked: '阻塞', failed: '失败', cancelled: '已取消', pending_review: '待复核', approved: '已批准', unknown: '未知', degraded: '降级' };
  return <span className={`tb-status tb-status-${status}`}>{labels[status] ?? status}</span>;
}

export function JsonDetails({ value, label = '查看原始响应' }: { value: unknown; label?: string }) {
  return <details className="tb-json"><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

export function ProjectCrumb({ projectId, label }: { projectId: string; label: string }) {
  return <div className="tb-breadcrumbs"><Link to="/projects">项目</Link><span>/</span><Link to={`/projects/${encodeURIComponent(projectId)}`}>{label}</Link></div>;
}
