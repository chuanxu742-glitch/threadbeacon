import React from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardClient } from '../app/components/dashboard-client';
import { PlatformClient } from '../app/components/platform-client';
import { SkillClient } from '../app/components/skill-client';
import '../app/globals.css';

const user = { displayName: 'ThreadBeacon Owner', email: 'owner@threadbeacon.local' };

function Docs() {
  return <main className="docs-shell"><section><p className="eyebrow">JAVA CONTROL PLANE</p><h1>ThreadBeacon API</h1><p>控制平面由 Spring Boot 提供，Worker 协议保持兼容。</p><div className="docs-grid"><article><h2>健康检查</h2><code>GET /api/health</code></article><article><h2>任务</h2><code>GET /api/jobs</code><br/><code>POST /api/jobs</code></article><article><h2>OpenAPI</h2><a href="/api/openapi">打开接口描述 →</a></article></div><a href="/">返回控制台</a></section></main>;
}

function App() {
  if (location.pathname.startsWith('/studio')) return <PlatformClient user={user}/>;
  if (location.pathname.startsWith('/skills')) return <SkillClient user={user}/>;
  if (location.pathname.startsWith('/docs')) return <Docs/>;
  return <DashboardClient user={user}/>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
