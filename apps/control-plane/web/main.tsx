import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardClient } from '../app/components/dashboard-client';
import { PlatformClient } from '../app/components/platform-client';
import { SkillPage } from '../app/components/skill-page';
import { LoginPage } from '../app/components/login-page';
import { ProductGuide } from '../app/components/product-guide';
import { AppNav } from '../app/components/app-nav';
import { basicCredential, clearAuthCredential, clearWorkspaceId, installAuthenticatedFetch, saveAuthCredential, saveWorkspaceId } from '../app/components/auth-client';
import { apiJson } from '../app/components/api-json';
import '../app/globals.css';
import '../app/refined-ui.css';

type User={displayName:string;email:string;role:string};
type AuthMethods={local:boolean;oidc:boolean;oidcUrl?:string};
installAuthenticatedFetch();

const utilityContext = (active:string) => [
  {id:'back',label:'返回今天',icon:'⌂',href:'/'},
  {id:'about',label:'项目与架构',icon:'?',href:'/about',active:active==='about'},
];

function UtilityFrame({user,onSignOut,active,contextLabel,children}:{user:User;onSignOut:()=>void;active:'reports'|'system'|'studio';contextLabel:string;children:React.ReactNode}) {
  return <div className="utility-shell"><AppNav active={active} user={user} onSignOut={onSignOut} contextLabel={contextLabel} contextItems={utilityContext(active)}/>{children}</div>;
}

function Docs({user,onSignOut}:{user:User;onSignOut:()=>void}) {
  const endpointGroups=[
    {eyebrow:'CORE',title:'运行与任务',copy:'从健康检查到队列执行，保持控制面与 Worker 的契约清晰。',items:[['GET','/api/health','健康检查'],['GET / POST','/api/jobs','创建、查询和管理任务'],['GET','/api/records','检索标准化记录']]},
    {eyebrow:'WORKFLOW',title:'研究流程',copy:'读取、发布并运行可版本化的研究 DAG。',items:[['GET / POST','/api/workflows','工作流与版本'],['PATCH','/api/workflows/:id','保存草稿与发布'],['GET','/api/workflow-runs','运行与检查点']]},
    {eyebrow:'GOVERNANCE',title:'治理与集成',copy:'权限、Skill、Webhook 与 MCP 都经过服务端边界校验。',items:[['GET / POST','/api/skills','Skill 版本与治理'],['POST','/api/integrations/webhooks','Webhook 触发器'],['POST','/api/mcp','MCP Streamable HTTP']]},
  ];
  return <UtilityFrame user={user} onSignOut={onSignOut} active="system" contextLabel="API 文档"><main className="utility-main docs-page"><header className="utility-header"><div><p className="eyebrow">JAVA CONTROL PLANE / API REFERENCE</p><h1>让系统边界也能被阅读。</h1><p>Spring Boot 控制平面负责身份、租约、工作流和审计；TypeScript Worker 保持执行协议兼容。</p></div><div className="utility-header-actions"><a className="secondary-button" href="/about">查看架构</a><a className="primary-button" href="/api/openapi" target="_blank" rel="noreferrer">打开 OpenAPI ↗</a></div></header><section className="docs-hero"><div><span className="docs-hero-mark">TB</span><div><strong>ThreadBeacon API</strong><p>REST + MCP · Bearer PAT / Basic / OIDC</p></div></div><code>BASE URL&nbsp;&nbsp;{typeof location==='undefined'?'http://127.0.0.1:8080':location.origin}/api</code></section><div className="docs-shortcuts"><a href="/api/openapi" target="_blank" rel="noreferrer"><span>↗</span><div><strong>OpenAPI 描述</strong><small>机器可读接口定义</small></div></a><a href="/api/mcp" target="_blank" rel="noreferrer"><span>◆</span><div><strong>MCP 服务</strong><small>JSON-RPC 2.0 / Streamable HTTP</small></div></a><a href="/about"><span>?</span><div><strong>安全边界</strong><small>凭据、Worker 与数据存储分层</small></div></a></div><div className="docs-section-heading"><div><p className="eyebrow">ENDPOINT MAP</p><h2>从能力到接口</h2></div><span>当前 API 由 Java 控制平面提供</span></div><div className="docs-endpoint-grid">{endpointGroups.map(group=><section className="docs-endpoint-card" key={group.title}><p className="eyebrow">{group.eyebrow}</p><h3>{group.title}</h3><p>{group.copy}</p><div>{group.items.map(([method,path,copy])=><a href="/api/openapi" target="_blank" rel="noreferrer" key={path}><b className={`http-${method.split(' ')[0].toLowerCase()}`}>{method}</b><code>{path}</code><small>{copy}</small><span>↗</span></a>)}</div></section>)}</div></main></UtilityFrame>;
}

function recordValue(value:unknown,key:string,fallback:string){return typeof value==='object'&&value!==null&&key in value?String((value as Record<string,unknown>)[key]??fallback):fallback;}

function ReportPage({user,onSignOut}:{user:User;onSignOut:()=>void}){const id=decodeURIComponent(location.pathname.split('/').pop()??''),[report,setReport]=useState<Record<string,unknown>|null>(null),[error,setError]=useState('');useEffect(()=>{void fetch(`/api/reports/${encodeURIComponent(id)}`,{cache:'no-store'}).then(async response=>{const body=await apiJson(response) as Record<string,unknown>&{error?:string};if(!response.ok)throw new Error(body.error??'报告加载失败');setReport(body);}).catch(reason=>setError(reason instanceof Error?reason.message:'报告加载失败'));},[id]);const title=String(report?.title??report?.keyword??report?.query??'研究报告'),summary=String(report?.summary??report?.executiveSummary??'');const findings=Array.isArray(report?.findings)?report.findings:Array.isArray(report?.painPoints)?report.painPoints:Array.isArray(report?.themes)?report.themes:[];return <UtilityFrame user={user} onSignOut={onSignOut} active="reports" contextLabel="报告详情"><main className="utility-main report-page"><header className="utility-header report-header"><div><div className="breadcrumbs"><a href="/">今天</a><span>/</span><span>报告</span><span>/</span><strong>{title}</strong></div><p className="eyebrow">EVIDENCE REPORT / {id.slice(0,8)}</p><h1>{title}</h1><p>研究结论、证据引用与运行元数据集中在同一份可复核产物中。</p></div><div className="utility-header-actions"><a className="secondary-button" href="/">← 返回今天</a><a className="primary-button" href={`/api/reports/${encodeURIComponent(id)}`} download>下载 JSON ↓</a></div></header>{error&&<section className="state-card error-state"><span>!</span><div><strong>报告暂时无法加载</strong><p>{error}</p></div><button type="button" onClick={()=>location.reload()}>重试</button></section>}{!error&&!report&&<section className="report-skeleton" aria-label="正在加载报告"><i/><i/><i/><i/></section>}{report&&<><section className="report-hero"><div><p className="eyebrow">EXECUTIVE SUMMARY</p><h2>这份研究留下了什么？</h2><p>{summary||'该报告未提供摘要，下面展示结构化发现与原始证据。'}</p></div><div className="report-hero-stamp"><span>TRACE</span><strong>可追溯</strong><small>原始 JSON 已保留</small></div></section><section className="report-metrics"><div><span>发现</span><strong>{findings.length}</strong></div><div><span>记录</span><strong>{String(report.itemCount??report.item_count??'—')}</strong></div><div><span>生成时间</span><strong>{String(report.generatedAt??report.generated_at??'—')}</strong></div><div><span>报告 ID</span><strong>{id.slice(0,12)}</strong></div></section><section className="report-section"><div className="section-heading"><div><p className="eyebrow">KEY FINDINGS</p><h2>关键发现</h2></div><span>{findings.length?`${findings.length} 个主题`:'暂无结构化发现'}</span></div>{findings.length>0?<div className="finding-grid">{findings.slice(0,8).map((item,index)=><article className="finding-card" key={index}><header><span>{String(index+1).padStart(2,'0')}</span><b>{recordValue(item,'severity','待复核')}</b></header><h3>{recordValue(item,'title',recordValue(item,'theme',`发现 ${index+1}`))}</h3><p>{recordValue(item,'summary',recordValue(item,'description',String(item)))}</p><footer><span>证据关联</span><strong>{recordValue(item,'source_count','—')} 条来源</strong></footer></article>)}</div>:<div className="state-card empty-state-card"><span>＋</span><div><strong>还没有结构化发现</strong><p>这份报告保留了原始结构，可以回到任务和项目页继续完善研究流程。</p></div><a href="/">返回今天 →</a></div>}</section><section className="json-viewer-card"><header><div><p className="eyebrow">RAW ARTIFACT</p><h2>原始报告与血缘数据</h2><p>用于复核和二次处理，完整 JSON 不在列表页展开。</p></div><a href={`/api/reports/${encodeURIComponent(id)}`} download>下载原始 JSON ↓</a></header><details open><summary>查看 JSON 结构</summary><pre>{JSON.stringify(report,null,2)}</pre></details></section></>}</main></UtilityFrame>}

void ReportPage;

function jsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function ReportPageReadable({user,onSignOut}:{user:User;onSignOut:()=>void}) {
  const id=decodeURIComponent(location.pathname.split('/').pop()??'');
  const [report,setReport]=useState<Record<string,unknown>|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{void fetch(`/api/reports/${encodeURIComponent(id)}`,{cache:'no-store'}).then(async response=>{const body=await apiJson(response) as Record<string,unknown>&{error?:string};if(!response.ok)throw new Error(body.error??'报告加载失败');setReport(body);}).catch(reason=>setError(reason instanceof Error?reason.message:'报告加载失败'));},[id]);
  const title=String(report?.title??report?.keyword??'研究报告');
  const summary=String(report?.summary??report?.executiveSummary??'');
  const findings=Array.isArray(report?.findings)?report.findings.filter((item):item is Record<string,unknown>=>typeof item==='object'&&item!==null):[];
  const observations=(report?.observationSummary??{}) as Record<string,unknown>;
  const quality=(report?.quality??{}) as Record<string,unknown>;
  const status=String(report?.reviewStatus??'pending_review');
  const statusLabel=status==='approved'?'已批准':status==='empty'?'无候选发现':'待人工复核';
  return <UtilityFrame user={user} onSignOut={onSignOut} active="reports" contextLabel="报告详情"><main className="utility-main report-page"><header className="utility-header report-header"><div><div className="breadcrumbs"><a href="/">今天</a><span>/</span><span>报告</span><span>/</span><strong>{title}</strong></div><p className="eyebrow">EVIDENCE REPORT / {id.slice(0,8)}</p><h1>{title}</h1><p>只展示已批准的 Finding；每条结论都可回溯到本轮观察的原始记录。</p></div><div className="utility-header-actions"><a className="secondary-button" href="/">← 返回今天</a><a className="primary-button" href={`/api/reports/${encodeURIComponent(id)}`} download>下载 JSON ↓</a></div></header>{error&&<section className="state-card error-state"><span>!</span><div><strong>报告暂时无法加载</strong><p>{error}</p></div><button type="button" onClick={()=>location.reload()}>重试</button></section>}{!error&&!report&&<section className="report-skeleton" aria-label="正在加载报告"><i/><i/><i/><i/></section>}{report&&<><section className="report-hero"><div><p className="eyebrow">{String(report.analysisMode??'snapshot').toUpperCase()} / {statusLabel}</p><h2>{summary||'这份报告已生成，下面展示可复核的结构化发现。'}</h2><p>研究方法：{String((report.method as Record<string,unknown>|undefined)?.key??'generic-research')} · 数据质量：{String(quality.dataQuality??report.dataQuality??'unknown')}</p></div><div className="report-hero-stamp"><span>TRACE</span><strong>{statusLabel}</strong><small>{String(quality.citationCount??0)} 条精确引用</small></div></section><section className="report-metrics"><div><span>已批准发现</span><strong>{findings.length}</strong></div><div><span>观察记录</span><strong>{String(observations.total??report.itemCount??'—')}</strong></div><div><span>变化 / 新增</span><strong>{String(Number(observations.changed??0)+Number(observations.new??0))}</strong></div><div><span>来源平台</span><strong>{String(quality.sourceCount??'—')}</strong></div></section><section className="report-section"><div className="section-heading"><div><p className="eyebrow">KEY FINDINGS</p><h2>关键发现与精确证据</h2></div><span>{findings.length?`${findings.length} 个已批准主题`:'暂无已批准发现'}</span></div>{findings.length>0?<div className="finding-grid">{findings.slice(0,8).map((item,index)=>{const refs=Array.isArray(item.evidenceRefs)?item.evidenceRefs.filter((ref):ref is Record<string,unknown>=>typeof ref==='object'&&ref!==null):[];const uncertainties=jsonStringArray(item.uncertainties_json);return <article className="finding-card report-finding-card" key={String(item.id??index)}><header><span>{String(index+1).padStart(2,'0')}</span><b>S{recordValue(item,'severity','—')}</b></header><h3>{recordValue(item,'theme',recordValue(item,'title',`发现 ${index+1}`))}</h3><p>{recordValue(item,'summary',recordValue(item,'description',''))}</p>{uncertainties.length>0&&<div className="report-uncertainties"><small>仍需确认</small>{uncertainties.slice(0,4).map((value,uncertaintyIndex)=><span key={uncertaintyIndex}>{String(value)}</span>)}</div>}<div className="report-evidence-refs"><small>精确引用 · {refs.length} 条</small>{refs.slice(0,5).map((ref,refIndex)=><a key={String(ref.observation_id??refIndex)} href={typeof ref.url==='string'&&ref.url?ref.url:'#'} target={typeof ref.url==='string'&&ref.url?'_blank':undefined} rel="noreferrer"><strong>{String(ref.title??'原始观察')}</strong><span>{String(ref.platform??'source')} · {String(ref.observed_at??ref.captured_at??'')}</span><code>{String(ref.content_hash??'').slice(0,12)}</code></a>)}</div></article>})}</div>:<div className="state-card empty-state-card"><span>＋</span><div><strong>还没有已批准的结构化发现</strong><p>候选 Finding 仍在结果与证据工作台等待复核。</p></div><a href="/studio#evidence">去复核 →</a></div>}</section><section className="json-viewer-card"><header><div><p className="eyebrow">RUN METADATA</p><h2>观察摘要</h2><p>本轮报告保留 baseline、new、changed、unchanged 四类观察计数。</p></div><span className="report-meta-pill">生成于 {String(report.generatedAt??report.generated_at??'—')}</span></header><pre className="report-summary-json">{JSON.stringify({method:report.method,observationSummary:report.observationSummary,quality:report.quality,reportId:report.reportId},null,2)}</pre></section></>}</main></UtilityFrame>;
}

function InvitePage({user,onSignOut}:{user:User;onSignOut:()=>void}){const token=new URLSearchParams(location.search).get('token')??'', [state,setState]=useState<'loading'|'success'|'error'>(token?'loading':'error'),[message,setMessage]=useState(token?'正在验证邀请凭据并加入工作区…':'邀请链接缺少 token');useEffect(()=>{if(!token)return;void fetch('/api/access/invitations/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})}).then(async response=>{const body=await apiJson(response) as {workspaceId?:string;workspace?:{id?:string};error?:string};if(!response.ok)throw new Error(body.error??'接受邀请失败');const id=body.workspaceId??body.workspace?.id;if(id)saveWorkspaceId(id);setState('success');setMessage('已加入工作区，正在准备你的研究桌面。');window.setTimeout(()=>{location.href='/studio'},900);}).catch(reason=>{setState('error');setMessage(reason instanceof Error?reason.message:'接受邀请失败');});},[token]);return <UtilityFrame user={user} onSignOut={onSignOut} active="studio" contextLabel="团队邀请"><main className="utility-main invite-page"><section className={`invite-card ${state}`}><div className="invite-brand"><span>TB</span><div><strong>ThreadBeacon</strong><small>TEAM WORKSPACE</small></div></div><div className="invite-status-icon">{state==='loading'?'…':state==='success'?'✓':'!'}</div><p className="eyebrow">{state==='loading'?'VERIFYING INVITATION':state==='success'?'WORKSPACE READY':'INVITATION ERROR'}</p><h1>{state==='success'?'欢迎加入研究工作区':state==='error'?'这个邀请暂时不可用':'正在加入团队'}</h1><p>{message}</p>{state==='loading'&&<div className="redirect-progress"><i/></div>}{state==='success'&&<div className="redirect-progress success"><i/></div>}<div className="invite-actions"><a className="primary-button" href="/studio">进入项目 →</a><a className="secondary-button" href="/">返回今天</a></div></section></main></UtilityFrame>}

function App({user,onSignOut}:{user:User;onSignOut:()=>void}) {
  return location.pathname.startsWith('/studio')?<PlatformClient user={user} onSignOut={onSignOut}/>
    :location.pathname.startsWith('/skills')?<SkillPage user={user} onSignOut={onSignOut}/>
    :location.pathname.startsWith('/reports/')?<ReportPageReadable user={user} onSignOut={onSignOut}/>
        :location.pathname.startsWith('/invite')?<InvitePage user={user} onSignOut={onSignOut}/>
          :location.pathname.startsWith('/docs')?<Docs user={user} onSignOut={onSignOut}/>:<DashboardClient user={user} onSignOut={onSignOut}/>;
}

function Root(){const[user,setUser]=useState<User|null>(null),[checking,setChecking]=useState(true),[methods,setMethods]=useState<AuthMethods>({local:true,oidc:false});
  async function verify(authorization?:string){const response=await fetch('/api/auth/me',{cache:'no-store',...(authorization?{headers:{authorization}}:{})});if(!response.ok)throw new Error(response.status===401?'用户名或密码不正确。':'控制平面暂时不可用。');const body=await response.json() as User;setUser(body);return body;}
  useEffect(()=>{void verify().catch(()=>{clearAuthCredential();setUser(null);}).finally(async()=>{try{const response=await fetch('/api/auth/methods',{cache:'no-store'});if(response.ok)setMethods(await response.json() as AuthMethods);}finally{setChecking(false);}});},[]);
  async function login(username:string,password:string){const credential=basicCredential(username.trim(),password);await verify(credential);saveAuthCredential(credential);}
  function signOut(){void fetch('/logout',{method:'POST'}).finally(()=>{clearAuthCredential();clearWorkspaceId();setUser(null);});}
  if(location.pathname.startsWith('/about'))return <ProductGuide/>;
  if(checking)return <main className="auth-loading"><span>TB</span><p>正在恢复安全会话…</p></main>;
  if(!user)return <LoginPage onLogin={login} localEnabled={methods.local} oidcEnabled={methods.oidc} oidcUrl={methods.oidcUrl}/>;
  return <App user={user} onSignOut={signOut}/>;
}

const mount=document.getElementById('root') as HTMLDivElement&{threadBeaconRoot?:ReturnType<typeof createRoot>};
const reactRoot=mount.threadBeaconRoot??createRoot(mount);
mount.threadBeaconRoot=reactRoot;
reactRoot.render(<React.StrictMode><Root/></React.StrictMode>);
