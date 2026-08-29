import { isBrowserActionType, type BrowserActionType } from './protocol.js';

export type BrowserInput=Record<string,unknown>;

export function normalizeBrowserAllowlist(input:unknown):string[]{
  if(!Array.isArray(input))return[];
  const values=[...new Set(input.map(String).map(value=>value.trim().toLowerCase().replace(/\.$/,'')).filter(Boolean))].slice(0,100);
  for(const value of values){const host=value.startsWith('*.')?value.slice(2):value;if(!host||host==='localhost'||host.endsWith('.local')||!/^[a-z0-9.-]+$/.test(host))throw new RangeError(`无效 allowlist：${value}`);}
  return values;
}

export function isAllowedBrowserHost(hostname:string,allowlist:readonly string[]):boolean{
  const host=hostname.toLowerCase().replace(/\.$/,'');
  return allowlist.some(pattern=>pattern.startsWith('*.')?host.endsWith(`.${pattern.slice(2)}`):host===pattern);
}

export function browserActionUrl(input:unknown,allowlist:readonly string[]):string{
  let url:URL;try{url=new URL(String(input??''));}catch{throw new RangeError('导航 URL 无效');}
  const host=url.hostname.toLowerCase(),privateLiteral=/^(?:127\.|10\.|169\.254\.|192\.168\.|0\.|::1$|fc|fd)/i.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||host==='localhost'||host.endsWith('.local')||privateLiteral||!isAllowedBrowserHost(host,allowlist))throw new RangeError('导航只允许 allowlist 中的公开 http/https 地址');
  return url.toString();
}

export function validateBrowserAction(type:unknown,input:unknown,allowlist:readonly string[]):{type:BrowserActionType;input:BrowserInput}{
  if(!isBrowserActionType(type)||String(type).startsWith('session.'))throw new RangeError('不支持的浏览器动作');
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('浏览器动作 input 必须是对象');
  const value={...(input as BrowserInput)};
  if(type==='navigate'||type==='tabs.open')value['url']=browserActionUrl(value['url'],allowlist);
  if(type==='type'&&(typeof value['text']!=='string'||value['text'].length<1||value['text'].length>10_000))throw new RangeError('输入文本长度必须是 1-10000');
  return{type,input:value};
}

export function redactBrowserActionInput(type:string,input:BrowserInput):BrowserInput{
  if(type==='type')return{selector:input['selector'],backendNodeId:input['backendNodeId'],clear:input['clear']===true,textLength:typeof input['text']==='string'?input['text'].length:0};
  if(type==='navigate'||type==='tabs.open'){try{const url=new URL(String(input['url']??''));return{url:`${url.origin}${url.pathname}`};}catch{return{url:'invalid'}}}
  return input;
}

async function payloadKey(secret:string){if(secret.length<16)throw new Error('浏览器动作加密密钥长度不足');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(value:string)=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
export async function encryptBrowserPayload(value:unknown,secret:string):Promise<string>{const iv=crypto.getRandomValues(new Uint8Array(12)),data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await payloadKey(secret),new TextEncoder().encode(JSON.stringify(value))));return`${encode(iv)}.${encode(data)}`;}
export async function decryptBrowserPayload(value:string,secret:string):Promise<BrowserInput>{const[a,b]=value.split('.');if(!a||!b)throw new Error('浏览器动作载荷损坏');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(a)},await payloadKey(secret),decode(b)))) as BrowserInput;}
