import { Link } from '../routes/router.js';

const items = [
  ['overview', '概览'],
  ['social', '社媒态势'],
  ['orchestration', '编排'],
  ['operations', '运行'],
  ['data', '数据与证据'],
  ['delivery', '报告与交付'],
  ['settings', '项目设置'],
] as const;

export function ProjectNav({ projectId, active }: { projectId: string; active: (typeof items)[number][0] }) {
  return <nav className="tb-project-nav" aria-label="项目导航">{items.map(([section, label]) => <Link key={section} to={section === 'overview' ? `/projects/${encodeURIComponent(projectId)}` : `/projects/${encodeURIComponent(projectId)}/${section}`} className={active === section ? 'active' : ''} aria-current={active === section ? 'page' : undefined}>{label}</Link>)}</nav>;
}
