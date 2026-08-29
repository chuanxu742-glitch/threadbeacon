import { lookup } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { CDPBridge } from '@jackwener/opencli/browser/cdp';
import { assertPublicSourceUrl, isPublicAddress } from '../providers/generic-web.js';
import { isAllowedBrowserHost, normalizeBrowserAllowlist } from './policy.js';
import type { BrowserActionCommand, BrowserActionResult, BrowserTab } from './protocol.js';

type CdpTarget = { id?:string;targetId?:string;type?:string;title?:string;url?:string;webSocketDebuggerUrl?:string };

function safeEndpoint(value:string):string {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Worker CDP endpoint 无效');
  return url.toString().replace(/\/$/,'');
}

export async function assertAllowedNavigation(input:string,allowlist:readonly string[],enforceAllowlist=true):Promise<URL>{
  const url=assertPublicSourceUrl(input);
  const normalized=normalizeBrowserAllowlist(allowlist);
  if(enforceAllowlist&&(!normalized.length||!isAllowedBrowserHost(url.hostname,normalized)))throw new Error(`导航主机不在 allowlist：${url.hostname}`);
  const addresses=await lookup(url.hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw new Error(`导航域名解析到了非公网地址：${url.hostname}`);
  return url;
}

async function json<T>(url:string,init?:RequestInit):Promise<T>{
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`CDP HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function tabs(endpoint:string):Promise<Array<CdpTarget>>{return json<Array<CdpTarget>>(`${endpoint}/json/list`);}
function displayUrl(input:string):string{try{const url=new URL(input);if(!['http:','https:'].includes(url.protocol))return url.protocol==='about:'?'about:blank':'[non-http-url]';return`${url.origin}${url.pathname}`;}catch{return'[invalid-url]';}}
function publicTab(target:CdpTarget):BrowserTab{return{id:String(target.id??target.targetId??''),title:String(target.title??'').slice(0,300),url:displayUrl(String(target.url??'')),type:String(target.type??'page')};}

async function newBlankTab(endpoint:string):Promise<CdpTarget>{
  return json<CdpTarget>(`${endpoint}/json/new?${encodeURIComponent('about:blank')}`,{method:'PUT'});
}

async function closeTab(endpoint:string,targetId:string):Promise<void>{
  const response=await fetch(`${endpoint}/json/close/${encodeURIComponent(targetId)}`,{signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw new Error(`CDP 关闭标签页失败：HTTP ${response.status}`);
}

async function target(endpoint:string,targetId?:string|null):Promise<CdpTarget>{
  const available=await tabs(endpoint);
  const selected=targetId?available.find(item=>(item.id??item.targetId)===targetId):available.find(item=>item.type==='page');
  if(!selected?.webSocketDebuggerUrl)throw new Error('目标标签页不存在或不支持 CDP');
  return selected;
}

async function withBridge<T>(endpoint:string,targetId:string|undefined|null,timeoutMs:number,run:(bridge:CDPBridge)=>Promise<T>):Promise<T>{
  const selected=await target(endpoint,targetId),bridge=new CDPBridge();
  await bridge.connect({cdpEndpoint:selected.webSocketDebuggerUrl,timeout:Math.max(1,Math.ceil(Math.min(timeoutMs,10_000)/1000))});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([run(bridge),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{void bridge.close();reject(new Error(`CDP 动作超过 ${timeoutMs}ms 超时限制`));},timeoutMs);})]);}finally{if(timer)clearTimeout(timer);await bridge.close();}
}

type NavigationGuard={dispose:()=>void;assertClean:()=>void};
async function enableNavigationGuard(bridge:CDPBridge,allowlist:readonly string[]):Promise<NavigationGuard>{
  await bridge.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  let blocked:Error|null=null;
  const handler=(raw:unknown)=>{void(async()=>{const event=raw as {requestId?:string;resourceType?:string;request?:{url?:string}};if(!event.requestId)return;try{await assertAllowedNavigation(String(event.request?.url??''),allowlist,event.resourceType==='Document');await bridge.send('Fetch.continueRequest',{requestId:event.requestId}).catch(()=>undefined);}catch(error){blocked=error instanceof Error?error:new Error('导航请求被安全策略阻止');await bridge.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(()=>undefined);}})();};
  bridge.on('Fetch.requestPaused',handler);
  return{dispose:()=>{bridge.off('Fetch.requestPaused',handler);},assertClean:()=>{if(blocked)throw blocked;}};
}

async function guardedNavigate(bridge:CDPBridge,url:string,allowlist:readonly string[]):Promise<void>{
  const parsed=await assertAllowedNavigation(url,allowlist,true),guard=await enableNavigationGuard(bridge,allowlist);
  try{await bridge.send('Page.enable');const loaded=bridge.waitForEvent('Page.loadEventFired',30_000).catch(()=>undefined);await bridge.send('Page.navigate',{url:parsed.toString()});await loaded;guard.assertClean();const history=await bridge.send('Page.getNavigationHistory') as {currentIndex?:number;entries?:Array<{url?:string}>};const current=history.entries?.[history.currentIndex??-1]?.url;if(current)await assertAllowedNavigation(current,allowlist,true);}finally{guard.dispose();await bridge.send('Fetch.disable').catch(()=>undefined);}
}

async function guardedClick(bridge:CDPBridge,input:Readonly<Record<string,unknown>>,allowlist:readonly string[]):Promise<void>{
  const guard=await enableNavigationGuard(bridge,allowlist);
  try{await bridge.send('Page.enable');await assertCurrentPage(bridge,allowlist);await click(bridge,input);await delay(750);guard.assertClean();await assertCurrentPage(bridge,allowlist);guard.assertClean();}finally{guard.dispose();await bridge.send('Fetch.disable').catch(()=>undefined);}
}

async function assertCurrentPage(bridge:CDPBridge,allowlist:readonly string[]):Promise<void>{const history=await bridge.send('Page.getNavigationHistory') as {currentIndex?:number;entries?:Array<{url?:string}>};const current=history.entries?.[history.currentIndex??-1]?.url;if(!current||current==='about:blank')return;await assertAllowedNavigation(current,allowlist,true);}

async function nodeId(bridge:CDPBridge,input:Readonly<Record<string,unknown>>):Promise<{nodeId?:number;backendNodeId?:number}>{
  if(Number.isInteger(input['backendNodeId']))return{backendNodeId:Number(input['backendNodeId'])};
  const selector=typeof input['selector']==='string'?input['selector'].trim():'';
  if(!selector||selector.length>500)throw new Error('click/type 必须提供有效 selector 或 backendNodeId');
  const document=await bridge.send('DOM.getDocument',{depth:1,pierce:false}) as {root?:{nodeId?:number}};
  const root=document.root?.nodeId;if(!root)throw new Error('无法读取页面 DOM');
  const matched=await bridge.send('DOM.querySelector',{nodeId:root,selector}) as {nodeId?:number};
  if(!matched.nodeId)throw new Error('未找到指定元素');
  return{nodeId:matched.nodeId};
}

async function click(bridge:CDPBridge,input:Readonly<Record<string,unknown>>):Promise<void>{
  const node=await nodeId(bridge,input);await bridge.send('DOM.scrollIntoViewIfNeeded',node).catch(()=>undefined);
  const model=await bridge.send('DOM.getBoxModel',node) as {model?:{content?:number[];border?:number[]}};
  const quad=model.model?.content??model.model?.border;if(!quad||quad.length<8)throw new Error('目标元素没有可点击区域');
  const x=(quad[0]!+quad[2]!+quad[4]!+quad[6]!)/4,y=(quad[1]!+quad[3]!+quad[5]!+quad[7]!)/4;
  await bridge.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await bridge.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await bridge.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
}

async function typeText(bridge:CDPBridge,input:Readonly<Record<string,unknown>>):Promise<number>{
  const text=typeof input['text']==='string'?input['text']:'';if(!text||text.length>10_000)throw new Error('输入文本长度必须是 1-10000');
  const node=await nodeId(bridge,input);await bridge.send('DOM.focus',node);
  if(input['clear']===true){await bridge.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2});await bridge.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2});await bridge.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace'});await bridge.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace'});}
  await bridge.send('Input.insertText',{text});return text.length;
}

export async function executeBrowserAction(command:BrowserActionCommand,cdpEndpoint=process.env['OPENCLI_CDP_ENDPOINT']??''):Promise<BrowserActionResult>{
  const endpoint=safeEndpoint(cdpEndpoint);const input=command.input,owned=command.allowedTargetIds??[];const requestedTarget=typeof input['targetId']==='string'?input['targetId']:undefined;if(requestedTarget&&!owned.includes(requestedTarget))throw new Error('目标标签页不属于当前浏览器会话');const targetId=requestedTarget??command.targetId??undefined;if(!['session.create','tabs.open','tabs.list','session.close'].includes(command.type)&&targetId&&!owned.includes(targetId))throw new Error('活动标签页不属于当前浏览器会话');
  switch(command.type){
    case'session.create':{const selected=await newBlankTab(endpoint);return{capability:'cdp',status:'completed',targetId:String(selected.id??selected.targetId),tabs:[publicTab(selected)]};}
    case'session.close':{const ids=[...new Set(owned)],existing=new Set((await tabs(endpoint)).map(item=>String(item.id??item.targetId)));const closed=ids.filter(id=>existing.has(id));const outcomes=await Promise.allSettled(closed.map(id=>closeTab(endpoint,id)));if(outcomes.some(item=>item.status==='rejected'))throw new Error('浏览器会话部分标签页关闭失败');return{capability:'cdp',status:'completed',detail:{closedTargetIds:ids}};}
    case'tabs.list':{const visible=new Set(owned);return{capability:'cdp',status:'completed',tabs:(await tabs(endpoint)).filter(item=>visible.has(String(item.id??item.targetId))).map(publicTab)};}
    case'tabs.open':{const url=String(input['url']??'');await assertAllowedNavigation(url,command.allowlist,true);const opened=await newBlankTab(endpoint),id=String(opened.id??opened.targetId);try{await withBridge(endpoint,id,command.timeoutMs,bridge=>guardedNavigate(bridge,url,command.allowlist));}catch(error){await closeTab(endpoint,id).catch(()=>undefined);throw error;}const visible=new Set([...owned,id]);return{capability:'cdp',status:'completed',targetId:id,tabs:(await tabs(endpoint)).filter(item=>visible.has(String(item.id??item.targetId))).map(publicTab)};}
    case'tabs.close':{if(!targetId)throw new Error('tabs.close 缺少 targetId');await closeTab(endpoint,targetId);return{capability:'cdp',status:'completed',detail:{closedTargetId:targetId}};}
    case'navigate':{if(!targetId)throw new Error('navigate 缺少活动标签页');const url=String(input['url']??'');await withBridge(endpoint,targetId,command.timeoutMs,bridge=>guardedNavigate(bridge,url,command.allowlist));return{capability:'cdp',status:'completed',targetId,detail:{url:new URL(url).origin+new URL(url).pathname}};}
    case'snapshot':{if(!targetId)throw new Error('snapshot 缺少活动标签页');return withBridge(endpoint,targetId,command.timeoutMs,async bridge=>{await assertCurrentPage(bridge,command.allowlist);await bridge.send('Accessibility.enable');const tree=await bridge.send('Accessibility.getFullAXTree') as {nodes?:Array<Record<string,unknown>>};const snapshot=(tree.nodes??[]).slice(0,500).map(item=>{const role=item['role'] as {value?:unknown}|undefined,name=item['name'] as {value?:unknown}|undefined;return{nodeId:item['nodeId'],backendNodeId:item['backendDOMNodeId'],role:String(role?.value??''),name:String(name?.value??'').slice(0,500)};});return{capability:'cdp',status:'completed',targetId,snapshot};});}
    case'click':{if(!targetId)throw new Error('click 缺少活动标签页');await withBridge(endpoint,targetId,command.timeoutMs,bridge=>guardedClick(bridge,input,command.allowlist));return{capability:'cdp',status:'completed',targetId};}
    case'type':{if(!targetId)throw new Error('type 缺少活动标签页');const length=await withBridge(endpoint,targetId,command.timeoutMs,async bridge=>{await assertCurrentPage(bridge,command.allowlist);return typeText(bridge,input);});return{capability:'cdp',status:'completed',targetId,detail:{insertedCharacters:length}};}
    case'screenshot':{if(!targetId)throw new Error('screenshot 缺少活动标签页');return withBridge(endpoint,targetId,command.timeoutMs,async bridge=>{await assertCurrentPage(bridge,command.allowlist);const format=input['format']==='jpeg'?'jpeg':'png';const captured=await bridge.send('Page.captureScreenshot',{format,quality:format==='jpeg'?Math.min(100,Math.max(1,Number(input['quality']??80))):undefined,fromSurface:true}) as {data?:string};if(!captured.data)throw new Error('浏览器没有返回截图');return{capability:'cdp',status:'completed',targetId,screenshotBase64:captured.data,screenshotMime:format==='jpeg'?'image/jpeg':'image/png'};});}
  }
}
