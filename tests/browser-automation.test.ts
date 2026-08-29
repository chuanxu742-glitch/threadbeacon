import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock('node:dns/promises',()=>({lookup:mocks.lookup}));
vi.mock('@jackwener/opencli/browser/cdp',()=>{
  class FakeBridge{
    private listeners=new Map<string,Set<(value:unknown)=>void>>();
    async connect(){return;}
    async close(){return;}
    on(name:string,handler:(value:unknown)=>void){const values=this.listeners.get(name)??new Set();values.add(handler);this.listeners.set(name,values);}
    off(name:string,handler:(value:unknown)=>void){this.listeners.get(name)?.delete(handler);}
    private emit(name:string,value:unknown){for(const handler of this.listeners.get(name)??[])handler(value);}
    async waitForEvent(){return undefined;}
    async send(method:string,params?:Record<string,unknown>):Promise<unknown>{
      if(method==='DOM.getDocument')return{root:{nodeId:1}};
      if(method==='DOM.querySelector')return{nodeId:2};
      if(method==='DOM.getBoxModel')return{model:{content:[0,0,10,0,10,10,0,10]}};
      if(method==='Input.dispatchMouseEvent'&&params?.['type']==='mouseReleased')queueMicrotask(()=>this.emit('Fetch.requestPaused',{requestId:'blocked-click',resourceType:'Document',request:{url:'http://169.254.169.254/latest/meta-data'}}));
      if(method==='Page.getNavigationHistory')return{currentIndex:0,entries:[{url:'https://app.example.com/home'}]};
      return{};
    }
  }
  return{CDPBridge:FakeBridge};
});

import { assertAllowedNavigation, executeBrowserAction } from '../src/browser-automation/executor.js';
import { decryptBrowserPayload, encryptBrowserPayload, isAllowedBrowserHost, redactBrowserActionInput, validateBrowserAction } from '../src/browser-automation/policy.js';
import { BROWSER_ACTION_TYPES, isBrowserActionType } from '../src/browser-automation/protocol.js';

describe('controlled browser protocol',()=>{
  beforeEach(()=>{mocks.lookup.mockReset();mocks.lookup.mockResolvedValue([{address:'93.184.216.34',family:4}]);vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request)=>{const url=String(input);if(url.endsWith('/json/list'))return Response.json([{id:'tab-1',type:'page',title:'owned',url:'https://app.example.com/home?token=secret',webSocketDebuggerUrl:'ws://cdp/devtools/page/1'},{id:'tab-other-session',type:'page',title:'private session',url:'https://other.example.com/private',webSocketDebuggerUrl:'ws://cdp/devtools/page/2'}]);throw new Error(`unexpected fetch ${url}`);}));});
  afterEach(()=>vi.unstubAllGlobals());

  it('exposes only the fixed action protocol and rejects eval-like actions',()=>{
    expect(BROWSER_ACTION_TYPES).toContain('snapshot');
    expect(isBrowserActionType('click')).toBe(true);
    expect(isBrowserActionType('eval')).toBe(false);
    expect(()=>validateBrowserAction('evaluate',{expression:'steal()'},['example.com'])).toThrow('不支持');
  });

  it('enforces exact/wildcard allowlists and rejects private destinations before execution',()=>{
    expect(isAllowedBrowserHost('api.example.com',['*.example.com'])).toBe(true);
    expect(isAllowedBrowserHost('example.com',['*.example.com'])).toBe(false);
    expect(()=>validateBrowserAction('navigate',{url:'file:///etc/passwd'},['example.com'])).toThrow();
    expect(()=>validateBrowserAction('navigate',{url:'http://127.0.0.1/admin'},['127.0.0.1'])).toThrow();
    expect(()=>validateBrowserAction('tabs.open',{url:'https://evil.test'},['example.com'])).toThrow('allowlist');
  });

  it('rejects public-looking names when DNS resolves to a private address',async()=>{
    mocks.lookup.mockResolvedValueOnce([{address:'127.0.0.1',family:4}]);
    await expect(assertAllowedNavigation('https://app.example.com',['*.example.com'])).rejects.toThrow('非公网');
  });

  it('keeps typed values encrypted and out of audit projections',async()=>{
    const input={selector:'#password',text:'never-print-this-secret',clear:true},secret='a-secure-test-key-at-least-16';
    const ciphertext=await encryptBrowserPayload(input,secret);
    expect(ciphertext).not.toContain(input.text);
    expect(await decryptBrowserPayload(ciphertext,secret)).toEqual(input);
    expect(redactBrowserActionInput('type',input)).toEqual({selector:'#password',backendNodeId:undefined,clear:true,textLength:23});
  });

  it('keeps the Fetch guard active during click and reports blocked private navigation',async()=>{
    await expect(executeBrowserAction({id:'a1',sessionId:'s1',type:'click',timeoutMs:3000,targetId:'tab-1',allowedTargetIds:['tab-1'],allowlist:['*.example.com'],input:{selector:'a#unsafe'}},'http://127.0.0.1:9222')).rejects.toThrow();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/json/list'),expect.anything());
  });

  it('isolates tabs between sessions sharing the same browser Profile',async()=>{
    const result=await executeBrowserAction({id:'a2',sessionId:'session-a',type:'tabs.list',timeoutMs:3000,targetId:'tab-1',allowedTargetIds:['tab-1'],allowlist:['*.example.com'],input:{}},'http://127.0.0.1:9222');
    expect(result.tabs).toEqual([{id:'tab-1',title:'owned',url:'https://app.example.com/home',type:'page'}]);
    await expect(executeBrowserAction({id:'a3',sessionId:'session-a',type:'screenshot',timeoutMs:3000,targetId:'tab-other-session',allowedTargetIds:['tab-1'],allowlist:['*.example.com'],input:{}},'http://127.0.0.1:9222')).rejects.toThrow('不属于当前浏览器会话');
  });
});
