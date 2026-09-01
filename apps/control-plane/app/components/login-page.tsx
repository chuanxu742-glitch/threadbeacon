import { useState, type FormEvent } from 'react';

export function LoginPage({onLogin,localEnabled,oidcEnabled,oidcUrl}:{
  onLogin:(username:string,password:string)=>Promise<void>;
  localEnabled:boolean;
  oidcEnabled:boolean;
  oidcUrl?:string;
}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[showPassword,setShowPassword]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const data=new FormData(event.currentTarget);try{await onLogin(String(data.get('username')??''),String(data.get('password')??''));}catch(reason){setError(reason instanceof Error?reason.message:'登录失败，请稍后重试。');}finally{setBusy(false);}}
  return <main className="login-shell">
    <section className="login-story" aria-label="产品介绍">
      <a className="login-brand" href="/about"><span>TB</span><div><strong>ThreadBeacon</strong><small>Research Intelligence Platform</small></div></a>
      <div className="login-pitch"><p className="eyebrow">OPEN-SOURCE · SELF-HOSTED</p><h1>让跨平台研究<br/>留下可信证据。</h1><p>统一采集公开信息，编排可复用研究流程，把模型结论连接回原始记录、运行轨迹和交付结果。</p></div>
      <div className="login-flow" aria-label="核心处理流程"><span>多源采集</span><i>→</i><span>标准化</span><i>→</i><span>聚类分析</span><i>→</i><span>证据报告</span></div>
      <div className="login-proof"><article><b>01</b><span><strong>数据不再散落</strong><small>项目、来源、任务和记录统一管理</small></span></article><article><b>02</b><span><strong>结论可以回溯</strong><small>证据、检查点和运行 Trace 全程留存</small></span></article><article><b>03</b><span><strong>部署边界清楚</strong><small>凭据留在 Worker，控制面可自托管</small></span></article></div>
      <a className="learn-product" href="/about">了解项目架构与核心流程 <span>↗</span></a>
    </section>
    <section className="login-panel">
      <form className="login-form" onSubmit={submit}>
        <div className="login-form-head"><span className="mobile-brand">TB</span><p className="eyebrow">WELCOME BACK</p><h2>回到团队工作台</h2><p>{localEnabled?'使用部署时配置的个人账号。':'通过部署方配置的身份登录。'}</p></div>
        {error&&<div className="login-error" role="alert"><span>!</span>{error}</div>}
        {localEnabled&&<>
          <label>用户名<input name="username" autoComplete="username" required autoFocus placeholder="请输入用户名"/></label>
          <label>密码<div className="password-field"><input name="password" type={showPassword?'text':'password'} autoComplete="current-password" required placeholder="请输入密码"/><button type="button" aria-label={showPassword?'隐藏密码':'显示密码'} onClick={()=>setShowPassword(value=>!value)}>{showPassword?'隐藏':'显示'}</button></div></label>
          <button className="login-submit" disabled={busy}>{busy?'正在验证…':'登录 ThreadBeacon'}<span>→</span></button>
          <p className="login-security"><i/>凭据仅保存在当前浏览器标签页；生产环境请使用 HTTPS。</p>
        </>}
        {oidcEnabled&&<>
          {localEnabled&&<div className="login-divider"><span>企业身份</span></div>}
          <a className="oidc-login" href={oidcUrl??'/oauth2/authorization/threadbeacon'}>使用企业 OIDC 登录 <span>→</span></a>
        </>}
        {!localEnabled&&!oidcEnabled&&<div className="login-error" role="alert"><span>!</span>当前部署没有启用可用的登录方式，请检查认证配置。</div>}
      </form>
      <footer><span>Apache-2.0 开源</span><a href="/about">产品说明</a><a href="https://github.com/chuanxu742-glitch/threadbeacon" target="_blank" rel="noreferrer">GitHub ↗</a></footer>
    </section>
  </main>;
}
