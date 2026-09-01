import { useEffect } from 'react';
import type { AuthUser } from '../shell/AppShell.js';
import { AppShell } from '../shell/AppShell.js';
import { ProductGuide } from '../components/product-guide.js';
import { Link, legacyRedirect, matchRoute, navigate, useLocation, type RouteMatch } from './router.js';
import { TodayPage } from '../features/today/TodayPage.js';
import { ProjectsPage, NewProjectPage } from '../features/projects/ProjectsPage.js';
import { ProjectOverviewPage } from '../features/projects/ProjectOverviewPage.js';
import { OrchestrationPage } from '../features/orchestration/OrchestrationPage.js';
import { OperationsPage } from '../features/operations/OperationsPage.js';
import { ResearchDataPage } from '../features/research-data/DataPage.js';
import { DeliveryPage } from '../features/delivery/DeliveryPage.js';
import { ProjectSettingsPage } from '../features/projects/ProjectSettingsPage.js';
import { ReportsPage } from '../features/reports/ReportsPage.js';
import { ReportDetailPage } from '../features/reports/ReportDetailPage.js';
import { AutomationPage } from '../features/automation/AutomationPage.js';
import { SetupPage } from '../features/setup/SetupPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';
import { SocialOverviewPage } from '../features/social/SocialOverviewPage.js';
import { SocialProjectPage } from '../features/social/SocialProjectPage.js';
import { SocialStreamsPage } from '../features/social/SocialStreamsPage.js';
import { SocialAccountsPage } from '../features/social/SocialAccountsPage.js';
import { SocialContentPage } from '../features/social/SocialContentPage.js';
import { SocialInsightsPage } from '../features/social/SocialInsightsPage.js';
import { SocialAlertsPage } from '../features/social/SocialAlertsPage.js';

function LegacyRedirect({ to }: { to: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => navigate(to, true), 260);
    return () => window.clearTimeout(timer);
  }, [to]);
  return <main className="tb-redirect-state"><div><span className="tb-brand-mark">TB</span><p className="tb-eyebrow">URL MIGRATION</p><h1>正在打开新的工作区入口…</h1><p>旧 Studio 地址已迁移到稳定路由：<Link to={to}>{to}</Link></p></div></main>;
}
function NotFoundPage() {
  return <div className="tb-page"><section className="tb-card tb-not-found"><p className="tb-eyebrow">404 / ROUTE NOT FOUND</p><h1>这个入口不存在</h1><p>请从稳定导航继续，项目上下文需要通过 URL 明确表达。</p><div><Link to="/today" className="tb-button tb-button-primary">返回今天</Link><Link to="/projects" className="tb-button tb-button-secondary">查看项目</Link></div></section></div>;
}

function ApiDocsPage() {
  const endpoints = ['GET /api/v2/me/context', 'GET /api/v2/attention', 'GET /api/v2/projects', 'GET /api/v2/projects/:id/readiness', 'GET /api/v2/social/overview', 'GET /api/v2/social/alerts', 'GET /api/v2/projects/:id/social/{overview|monitors|content|accounts|insights|alerts}', 'POST/PATCH /api/v2/projects/:id/social/monitors', 'PATCH /api/v2/projects/:id/social/alerts/:alertId', 'POST /api/v2/projects/:id/social/alerts/:alertId/{resolve|ignore}', 'POST /api/v2/workflows/:id/validate', 'POST /api/v2/workflows/:id/publish', 'GET /api/v2/projects/:id/runs', 'GET /api/v2/projects/:id/observations', 'GET /api/v2/reports/:id'];
  return <div className="tb-page"><section className="tb-card"><p className="tb-eyebrow">V2 CONTRACT</p><h1>控制面 API</h1><p className="tb-page-description">新 UI 只通过集中式 v2 client 访问资源；错误统一为 code、message、details 和 correlationId。</p><div className="tb-endpoint-list">{endpoints.map(endpoint => <code key={endpoint}>{endpoint}</code>)}</div><Link to="/today" className="tb-button tb-button-primary">返回工作台 →</Link></section></div>;
}

function renderRoute(route: RouteMatch) {
  switch (route.kind) {
    case 'today': return <TodayPage/>;
    case 'projects': return <ProjectsPage/>;
    case 'project-new': return <NewProjectPage/>;
    case 'project':
      if (route.section === 'orchestration') return <OrchestrationPage projectId={route.projectId}/>;
      if (route.section === 'operations') return <OperationsPage projectId={route.projectId}/>;
      if (route.section === 'data') return <ResearchDataPage projectId={route.projectId}/>;
      if (route.section === 'delivery') return <DeliveryPage projectId={route.projectId}/>;
      if (route.section === 'settings') return <ProjectSettingsPage projectId={route.projectId}/>;
      if (route.section === 'social') return <SocialProjectPage projectId={route.projectId}/>;
      return <ProjectOverviewPage projectId={route.projectId}/>;
    case 'project-social':
      if (route.section === 'streams') return <SocialStreamsPage projectId={route.projectId}/>;
      if (route.section === 'accounts') return <SocialAccountsPage projectId={route.projectId}/>;
      if (route.section === 'content') return <SocialContentPage projectId={route.projectId}/>;
      if (route.section === 'insights') return <SocialInsightsPage projectId={route.projectId}/>;
      if (route.section === 'alerts') return <SocialAlertsPage projectId={route.projectId}/>;
      return <SocialProjectPage projectId={route.projectId}/>;
    case 'social':
      if (route.section === 'streams') return <SocialStreamsPage/>;
      if (route.section === 'accounts') return <SocialAccountsPage/>;
      if (route.section === 'content') return <SocialContentPage/>;
      if (route.section === 'insights') return <SocialInsightsPage/>;
      if (route.section === 'alerts') return <SocialAlertsPage/>;
      return <SocialOverviewPage/>;
    case 'reports': return <ReportsPage/>;
    case 'report': return <ReportDetailPage reportId={route.reportId}/>;
    case 'automation': return <AutomationPage/>;
    case 'setup': return <SetupPage/>;
    case 'settings': return <SettingsPage section={route.section}/>;
    case 'docs': return <ApiDocsPage/>;
    case 'not-found': return <NotFoundPage/>;
    case 'about': return <ProductGuide/>;
  }
}

export function AppRouter({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const location = useLocation();
  const migration = legacyRedirect(location.pathname, location.hash);
  if (migration) return <LegacyRedirect to={migration}/>;
  const route = matchRoute(location.pathname);
  if (route.kind === 'about') return <ProductGuide/>;
  return <AppShell user={user} onSignOut={onSignOut}>{renderRoute(route)}</AppShell>;
}
