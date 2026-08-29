import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardClient } from '../app/components/dashboard-client';
import { PlatformClient } from '../app/components/platform-client';
import { SkillClient } from '../app/components/skill-client';
import { LoginPage } from '../app/components/login-page';
import { ProductGuide } from '../app/components/product-guide';
import { basicCredential, clearAuthCredential, installAuthenticatedFetch, saveAuthCredential } from '../app/components/auth-client';
import '../app/globals.css';

type User={displayName:string;email:string;role:string};
type AuthMethods={local:boolean;oidc:boolean;oidcUrl?:string};
installAuthenticatedFetch();

function Docs() {
  return <main className="docs-shell"><section><p className="eyebrow">JAVA CONTROL PLANE</p><h1>ThreadBeacon API</h1><p>控制平面由 Spring Boot 提供，Worker 协议保持兼容。</p><div className="docs-grid"><article><h2>健康检查</h2><code>GET /api/health</code></article><article><h2>任务</h2><code>GET /api/jobs</code><br/><code>POST /api/jobs</code></article><article><h2>OpenAPI</h2><a href="/api/openapi">打开接口描述 →</a></article></div><div className="docs-links"><a href="/">返回控制台</a><a href="/about">项目背景与架构 →</a></div></section></main>;
}

function App({user,onSignOut}:{user:User;onSignOut:()=>void}) {
  const page=location.pathname.startsWith('/studio')?<PlatformClient user={user}/>
    :location.pathname.startsWith('/skills')?<SkillClient user={user}/>
      :location.pathname.startsWith('/docs')?<Docs/>:<DashboardClient user={user}/>;
  return <>{page}<button className="session-signout" onClick={onSignOut} title="退出当前会话"><span>{user.displayName.slice(0,1).toUpperCase()}</span>退出</button></>;
}

function Root(){const[user,setUser]=useState<User|null>(null),[checking,setChecking]=useState(true),[methods,setMethods]=useState<AuthMethods>({local:true,oidc:false});
  async function verify(authorization?:string){const response=await fetch('/api/auth/me',{cache:'no-store',...(authorization?{headers:{authorization}}:{})});if(!response.ok)throw new Error(response.status===401?'用户名或密码不正确。':'控制平面暂时不可用。');const body=await response.json() as User;setUser(body);return body;}
  useEffect(()=>{void verify().catch(()=>{clearAuthCredential();setUser(null);}).finally(async()=>{try{const response=await fetch('/api/auth/methods',{cache:'no-store'});if(response.ok)setMethods(await response.json() as AuthMethods);}finally{setChecking(false);}});},[]);
  async function login(username:string,password:string){const credential=basicCredential(username.trim(),password);await verify(credential);saveAuthCredential(credential);}
  function signOut(){void fetch('/logout',{method:'POST'}).finally(()=>{clearAuthCredential();setUser(null);});}
  if(location.pathname.startsWith('/about'))return <ProductGuide/>;
  if(checking)return <main className="auth-loading"><span>TB</span><p>正在恢复安全会话…</p></main>;
  if(!user)return <LoginPage onLogin={login} localEnabled={methods.local} oidcEnabled={methods.oidc}/>;
  return <App user={user} onSignOut={signOut}/>;
}

const mount=document.getElementById('root') as HTMLDivElement&{threadBeaconRoot?:ReturnType<typeof createRoot>};
const reactRoot=mount.threadBeaconRoot??createRoot(mount);
mount.threadBeaconRoot=reactRoot;
reactRoot.render(<React.StrictMode><Root/></React.StrictMode>);
