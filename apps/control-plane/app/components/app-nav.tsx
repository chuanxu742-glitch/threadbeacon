import { useEffect, useState, type ReactNode } from 'react';
import { saveWorkspaceId, workspaceId } from './auth-client.js';

type ProductArea = 'dashboard' | 'studio' | 'skills' | 'reports' | 'system';

export type ContextNavItem = {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
};

type AppNavProps = {
  active: ProductArea;
  user: { displayName: string; email: string };
  onSignOut: () => void;
  status?: 'healthy' | 'syncing' | 'error';
  contextLabel?: string;
  contextItems?: ContextNavItem[];
  notice?: ReactNode;
};

const productAreas: Array<{ id: ProductArea; label: string; caption: string; href: string; icon: string }> = [
  { id: 'dashboard', label: '今天', caption: '状态、待处理与成果', href: '/', icon: '⌁' },
  { id: 'studio', label: '项目', caption: '来源、流程与证据', href: '/studio', icon: '◇' },
  { id: 'reports', label: '报告', caption: '可读、复核与交付', href: '/#reports', icon: '▤' },
  { id: 'skills', label: '自动化', caption: '助手、版本与确认', href: '/skills', icon: '◈' },
  { id: 'system', label: '团队与系统', caption: '成员、节点与接口', href: '/studio#resources', icon: '▣' },
];

export function AppNav({ active, user, onSignOut, status = 'healthy', contextLabel, contextItems = [], notice }: AppNavProps) {
  const [workspaces,setWorkspaces]=useState<Array<{id:string;name:string;role:string}>>([]),[selected,setSelected]=useState(workspaceId());
  useEffect(()=>{let alive=true;void fetch('/api/access/workspaces',{cache:'no-store'}).then(async response=>response.ok?response.json():{}).then((body:{workspaces?:Array<{id:string;name:string;role:string}>}|Array<{id:string;name:string;role:string}>)=>{if(!alive)return;const list=Array.isArray(body)?body:body.workspaces??[];setWorkspaces(list);if(!selected&&list[0]){saveWorkspaceId(list[0].id);setSelected(list[0].id);}}).catch(()=>{});return()=>{alive=false};},[selected]);
  const statusText = status === 'error' ? '控制面连接异常' : status === 'syncing' ? '正在同步状态' : '控制面已连接';
  const current=workspaces.find(item=>item.id===selected);
  return <aside className="app-nav">
    <a href="/" className="app-nav-brand" aria-label="ThreadBeacon 首页"><span>TB</span><strong>ThreadBeacon<small>团队研究工作台</small></strong></a>
    <nav className="app-nav-products" aria-label="产品导航">{productAreas.map(item => <a key={item.id} className={active === item.id ? 'active' : ''} href={item.href} aria-current={active === item.id ? 'page' : undefined}><i>{item.icon}</i><span><strong>{item.label}</strong><small>{item.caption}</small></span></a>)}</nav>
    {contextItems.length > 0 && <div className="app-nav-context"><small>{contextLabel ?? '当前模块'}</small><nav aria-label={contextLabel ?? '当前模块导航'}>{contextItems.map(item => item.href ? <a key={item.id} className={item.active ? 'active' : ''} href={item.href}><i>{item.icon}</i>{item.label}</a> : <button type="button" key={item.id} className={item.active ? 'active' : ''} onClick={item.onClick}><i>{item.icon}</i>{item.label}</button>)}</nav></div>}
    {notice}
    {workspaces.length>0&&<label className="app-nav-workspace"><small>当前工作区</small><select value={selected} onChange={event=>{saveWorkspaceId(event.target.value);setSelected(event.target.value);location.reload();}}>{workspaces.map(item=><option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select>{current&&<em>{current.role}</em>}</label>}
    <nav className="app-nav-support" aria-label="帮助与文档"><a href="/docs"><i>⌘</i>API 文档</a><a href="/about"><i>?</i>项目与架构</a></nav>
    <div className={`app-nav-status ${status}`}><i/><span><strong>{statusText}</strong><small>数据与 Worker 状态</small></span></div>
    <div className="app-nav-user"><span>{user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.email}</small></div><button type="button" onClick={onSignOut} aria-label="退出当前会话" title="退出当前会话">退出</button></div>
  </aside>;
}
