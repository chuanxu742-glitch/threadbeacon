import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApiQuery } from '../api/use-api.js';
import { asItems, asRecord, objectId, text, v2, type JsonRecord } from '../api/v2.js';
import { LoadingState } from '../components/states.js';
import { Link, useLocation } from '../routes/router.js';
import { saveWorkspaceId, workspaceId } from '../components/auth-client.js';

export type AuthUser = { displayName: string; email: string; role?: string };

type NavItem = { href: string; label: string; caption: string; icon: string; matches: (path: string) => boolean };

const navItems: NavItem[] = [
  { href: '/today', label: '今天', caption: '待处理与系统脉搏', icon: '◌', matches: path => path === '/today' },
  { href: '/projects', label: '项目', caption: '持续研究与流程', icon: '◈', matches: path => path.startsWith('/projects') },
  { href: '/social', label: '社媒态势', caption: '监听、内容与洞察', icon: '◎', matches: path => path.startsWith('/social') },
  { href: '/reports', label: '报告', caption: '发现、证据与版本', icon: '▤', matches: path => path.startsWith('/reports') },
  { href: '/automation', label: '自动化', caption: '重复运行的方法', icon: '◇', matches: path => path.startsWith('/automation') },
  { href: '/setup', label: '设置中心', caption: '就绪度与运行资源', icon: '⚙', matches: path => path.startsWith('/setup') || path.startsWith('/settings') },
];

function nameFromContext(value: unknown): string {
  const record = asRecord(value);
  const workspace = asRecord(record.workspace);
  return text(workspace.name ?? record.workspaceName, '当前工作区');
}

function workspacesFromContext(value: unknown): Array<{ id: string; name: string; role: string }> {
  const record = asRecord(value);
  const items = asItems<JsonRecord>(record, 'workspaces', 'items');
  return items.map(item => ({ id: objectId(item), name: text(item.name, '未命名工作区'), role: text(item.role, '成员') })).filter(item => item.id);
}

export function AppShell({ user, onSignOut, children }: { user: AuthUser; onSignOut: () => void; children: ReactNode }) {
  const location = useLocation();
  const context = useApiQuery(v2.context, []);
  const workspaces = useMemo(() => workspacesFromContext(context.data), [context.data]);
  const selected = workspaceId();
  const currentWorkspace = workspaces.find(item => item.id === selected) ?? workspaces[0];
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!selected && currentWorkspace?.id) saveWorkspaceId(currentWorkspace.id);
  }, [currentWorkspace?.id, selected]);

  return <div className="tb-shell">
    <button type="button" className="tb-mobile-toggle" aria-label="打开导航" onClick={() => setMobileOpen(value => !value)}>☰</button>
    <aside className={`tb-sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="tb-brand"><span>TB</span><div><strong>ThreadBeacon</strong><small>研究工作台</small></div></div>
      <div className="tb-workspace-switcher">
        <small>当前工作区</small>
        {context.loading ? <LoadingState label="读取工作区…"/> : <select aria-label="切换工作区" value={currentWorkspace?.id ?? ''} onChange={event => { saveWorkspaceId(event.target.value); window.location.reload(); }} disabled={workspaces.length === 0}>
          {workspaces.length === 0 ? <option value="">{context.error ? '工作区上下文不可用' : '暂无可用工作区'}</option> : workspaces.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>}
        {currentWorkspace && <span>{currentWorkspace.role}</span>}
        {!context.loading && context.error && <em>v2 上下文未返回，页面仍可浏览</em>}
      </div>
      <nav className="tb-global-nav" aria-label="全局导航">{navItems.map(item => <Link key={item.href} to={item.href} className={item.matches(location.pathname) ? 'active' : undefined} onClick={() => setMobileOpen(false)}><i aria-hidden="true">{item.icon}</i><span><strong>{item.label}</strong><small>{item.caption}</small></span></Link>)}</nav>
      <div className="tb-sidebar-footer"><Link to="/settings/workspace">团队与系统 <span>→</span></Link><Link to="/about">产品与架构 <span>↗</span></Link><div className="tb-health"><i/><span><strong>{context.error ? '等待控制面' : '控制面已连接'}</strong><small>v2 API 状态</small></span></div><div className="tb-user"><span>{user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.email}</small></div><button type="button" onClick={onSignOut}>退出</button></div></div>
    </aside>
    <main className="tb-main"><div className="tb-topbar"><div><p className="tb-kicker">THREADBEACON / CONTROL PLANE</p><span className="tb-location">{nameFromContext(context.data)}</span></div><div className="tb-topbar-actions"><Link to="/today">待处理中心</Link><Link to="/settings/workspace">工作区设置</Link></div></div>{children}</main>
  </div>;
}
