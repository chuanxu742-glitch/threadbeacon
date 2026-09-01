import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

export type RouteMatch =
  | { kind: 'today' }
  | { kind: 'projects' }
  | { kind: 'project-new' }
  | { kind: 'project'; projectId: string; section: 'overview' | 'orchestration' | 'operations' | 'data' | 'delivery' | 'settings' }
  | { kind: 'reports' }
  | { kind: 'report'; reportId: string }
  | { kind: 'automation' }
  | { kind: 'setup' }
  | { kind: 'settings'; section: 'workspace' | 'members' | 'connections' | 'execution' | 'developer' | 'audit' }
  | { kind: 'docs' }
  | { kind: 'about' }
  | { kind: 'not-found' };

export const stableRoutes = [
  '/today', '/projects', '/projects/new', '/projects/:projectId',
  '/projects/:projectId/orchestration', '/projects/:projectId/operations',
  '/projects/:projectId/data', '/projects/:projectId/delivery', '/projects/:projectId/settings',
  '/reports', '/reports/:reportId', '/automation', '/setup', '/settings',
  '/settings/workspace', '/settings/members', '/settings/connections', '/settings/execution',
  '/settings/developer', '/settings/audit',
] as const;

type LocationState = { pathname: string; search: string; hash: string };

function currentLocation(): LocationState {
  return { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash };
}

export function useLocation(): LocationState {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onPopState = () => setLocation(currentLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return location;
}

export function navigate(to: string, replace = false) {
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function Link({ to, children, className, onClick }: { to: string; children: ReactNode; className?: string; onClick?: () => void }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || to.startsWith('http')) return;
    event.preventDefault();
    onClick?.();
    navigate(to);
  }
  return <a href={to} className={className} onClick={handleClick}>{children}</a>;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function legacyRedirect(pathname: string, hash: string): string | null {
  if (pathname === '/') return '/today';
  if (pathname !== '/studio' && !pathname.startsWith('/studio/')) return null;
  const tab = hash.replace(/^#/, '').toLowerCase();
  if (tab.includes('project')) return '/projects';
  if (tab.includes('workflow')) return '/projects';
  if (tab.includes('evidence') || tab.includes('record')) return '/projects';
  if (tab.includes('report')) return '/reports';
  if (tab.includes('resource') || tab.includes('setting')) return '/settings/execution';
  return '/projects';
}

export function matchRoute(pathname: string): RouteMatch {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/today') return { kind: 'today' };
  if (path === '/projects') return { kind: 'projects' };
  if (path === '/projects/new') return { kind: 'project-new' };
  const project = path.match(/^\/projects\/([^/]+)(?:\/([^/]+))?$/);
  if (project) {
    const section = project[2] as string | undefined;
    const allowed = ['orchestration', 'operations', 'data', 'delivery', 'settings'] as const;
    if (section && !allowed.includes(section as typeof allowed[number])) return { kind: 'not-found' };
    return { kind: 'project', projectId: decode(project[1]), section: allowed.includes(section as typeof allowed[number]) ? section as typeof allowed[number] : 'overview' };
  }
  if (path === '/reports') return { kind: 'reports' };
  const report = path.match(/^\/reports\/([^/]+)$/);
  if (report) return { kind: 'report', reportId: decode(report[1]) };
  if (path === '/automation') return { kind: 'automation' };
  if (path === '/setup') return { kind: 'setup' };
  if (path === '/settings' || path === '/settings/workspace') return { kind: 'settings', section: 'workspace' };
  const setting = path.match(/^\/settings\/(members|connections|execution|developer|audit)$/);
  if (setting) return { kind: 'settings', section: setting[1] as 'members' | 'connections' | 'execution' | 'developer' | 'audit' };
  if (path === '/about') return { kind: 'about' };
  if (path === '/docs') return { kind: 'docs' };
  return { kind: 'not-found' };
}
