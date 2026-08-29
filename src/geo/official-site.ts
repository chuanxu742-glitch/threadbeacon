import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { CDPBridge } from '@jackwener/opencli/browser/cdp';
import { assertPublicSourceUrl, isPublicAddress, PinnedSafeTransport, robotsAllows } from '../providers/generic-web.js';
import { buildSourceItem } from '../providers/item.js';
import type { OpenCliCommand } from '../providers/opencli.js';
import type { AnalysisReport } from '../pipeline/report.js';
import { browserProfileKind } from '../browser-profile.js';

export const OFFICIAL_SITE_CAPABILITY = Object.freeze({
  id: 'official-site.observe',
  version: '1.0.0',
  outputSchemaVersion: '1',
  runtime: {
    provider: '@jackwener/opencli',
    opencliVersion: '1.8.5',
    transport: 'cdp',
  },
});

export interface OfficialSiteObservation {
  capabilityId: typeof OFFICIAL_SITE_CAPABILITY.id;
  capabilityVersion: typeof OFFICIAL_SITE_CAPABILITY.version;
  outputSchemaVersion: typeof OFFICIAL_SITE_CAPABILITY.outputSchemaVersion;
  requestedUrl: string;
  finalUrl: string;
  accessState: 'accessible' | 'login-wall' | 'blocked' | 'personalized';
  accessMarkers: string[];
  personalizationDetected: boolean;
  personalizationMarkers: string[];
  title: string;
  canonicalUrl?: string;
  description?: string;
  bodyText: string;
  bodyTextLength: number;
  bodyTextTruncated: boolean;
  bodyTextSha256: string;
  domLength: number;
  domSha256: string;
  observedAt: string;
}

export interface GeoJobOptions {
  capabilityId: typeof OFFICIAL_SITE_CAPABILITY.id;
  capabilityVersion: typeof OFFICIAL_SITE_CAPABILITY.version;
  outputSchemaVersion: typeof OFFICIAL_SITE_CAPABILITY.outputSchemaVersion;
}

export type OfficialSiteObserver = (url: string, env?: NodeJS.ProcessEnv) => Promise<OfficialSiteObservation>;

const BODY_TEXT_LIMIT = 256 * 1024;
const PAGE_TIMEOUT_MS = 60_000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEndpoint(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('OPENCLI_CDP_ENDPOINT 必须是无内嵌凭据的 http/https URL');
  }
  return url.toString().replace(/\/$/, '');
}

async function assertPublicUrl(input: string): Promise<URL> {
  const url = assertPublicSourceUrl(input);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error(`GEO 目标域名解析到了非公网地址：${url.hostname}`);
  }
  return url;
}

async function checkRobots(url: URL): Promise<void> {
  const response = await new PinnedSafeTransport(15_000, 512 * 1024)
    .get(new URL('/robots.txt', url.origin).toString(), { 'user-agent': 'ThreadBeaconGEO/1.0' });
  if (response.status === 404) return;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`robots.txt 检查失败（HTTP ${response.status}）`);
  }
  if (!robotsAllows(response.body, url.pathname, 'ThreadBeaconGEO')) {
    throw new Error('robots.txt 不允许 GEO 观测该页面');
  }
}

type CdpTarget = { id?: string; targetId?: string; webSocketDebuggerUrl?: string };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function closeTab(endpoint: string, id: string): Promise<void> {
  const response = await fetch(`${endpoint}/json/close/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`CDP 关闭 GEO 标签页失败：HTTP ${response.status}`);
}

function resultValue<T>(result: unknown): T {
  const value = (result as { result?: { value?: unknown } })?.result?.value;
  if (!value || typeof value !== 'object') throw new Error('浏览器没有返回可用的 GEO 页面快照');
  return value as T;
}

function accessState(snapshot: {
  text: string;
  personalizationMarkers: string[];
  loginWall: boolean;
  blocked: boolean;
}): OfficialSiteObservation['accessState'] {
  if (snapshot.personalizationMarkers.length) return 'personalized';
  if (snapshot.loginWall) return 'login-wall';
  if (snapshot.blocked || !snapshot.text.trim()) return 'blocked';
  return 'accessible';
}

/**
 * 参考 opencli-Razormind 的 official-site.observe：只在显式匿名 Chrome Profile
 * 上运行，先做 SSRF/robots 检查，再经 OpenCLI 的 CDP bridge 读取公开页面。
 */
export async function observeOfficialSite(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OfficialSiteObservation> {
  if (browserProfileKind(env) !== 'anonymous') {
    throw new Error('GEO official-site.observe 只允许 THREADBEACON_BROWSER_PROFILE_KIND=anonymous 的干净浏览器 Profile');
  }
  const endpoint = safeEndpoint(env['OPENCLI_CDP_ENDPOINT']?.trim() ?? '');
  const requested = await assertPublicUrl(input);
  await checkRobots(requested);

  const target = await json<CdpTarget>(`${endpoint}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const targetId = String(target.id ?? target.targetId ?? '');
  if (!targetId || !target.webSocketDebuggerUrl) throw new Error('CDP 没有创建可用的 GEO 标签页');
  const bridge = new CDPBridge();
  try {
    await bridge.connect({ cdpEndpoint: target.webSocketDebuggerUrl, timeout: 10 });
    await bridge.send('Page.enable');
    await bridge.send('Network.clearBrowserCookies');
    await bridge.send('Network.clearBrowserCache');
    await bridge.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
    let blockedNavigation: Error | null = null;
    const navigationGuard = (raw: unknown) => {
      void (async () => {
        const event = raw as { requestId?: string; request?: { url?: string } };
        if (!event.requestId) return;
        try {
          await assertPublicUrl(String(event.request?.url ?? ''));
          await bridge.send('Fetch.continueRequest', { requestId: event.requestId });
        } catch (error) {
          blockedNavigation = error instanceof Error ? error : new Error('GEO 导航被安全策略阻止');
          await bridge.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => undefined);
        }
      })();
    };
    bridge.on('Fetch.requestPaused', navigationGuard);
    const loaded = bridge.waitForEvent('Page.loadEventFired', PAGE_TIMEOUT_MS).catch(() => undefined);
    await bridge.send('Page.navigate', { url: requested.toString() });
    await loaded;
    if (blockedNavigation) throw blockedNavigation;

    const evaluated = await bridge.send('Runtime.evaluate', {
      expression: `(() => {
        const html = document.documentElement?.outerHTML || '';
        const text = document.body?.innerText || '';
        const lower = text.toLowerCase();
        const personalizationMarkers = [];
        if (document.querySelector('[href*="logout" i], [data-testid*="user-menu" i], [aria-label*="profile" i], [aria-label*="avatar" i]')) personalizationMarkers.push('account-control');
        if (document.querySelector('meta[name="user-id"], meta[name="current-user"], meta[property="profile:username"]')) personalizationMarkers.push('identity-meta');
        const signInMarker = /(?:sign in|log in|登录|登入)/i.test(text);
        const loginWall = Boolean(document.querySelector('input[type="password"], form[action*="login" i], form[action*="signin" i]')) && text.length < 5000;
        const blocked = /(?:access denied|forbidden|captcha|verify you are human|访问被拒绝|人机验证)/i.test(lower);
        return {
          html, text, title: document.title || '', finalUrl: location.href,
          canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || '',
          description: document.querySelector('meta[name="description"]')?.content || '',
          personalizationMarkers, signInMarker, loginWall, blocked
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const snapshot = resultValue<{
      html: string; text: string; title: string; finalUrl: string; canonicalUrl: string;
      description: string; personalizationMarkers: string[]; signInMarker: boolean; loginWall: boolean; blocked: boolean;
    }>(evaluated);
    const finalUrl = await assertPublicUrl(snapshot.finalUrl);
    const state = accessState(snapshot);
    const accessMarkers = [
      ...(snapshot.signInMarker ? ['sign-in'] : []),
      ...(snapshot.loginWall ? ['login-control'] : []),
      ...(snapshot.blocked ? ['access-challenge'] : []),
    ];
    const bodyText = snapshot.text.slice(0, BODY_TEXT_LIMIT);
    return {
      capabilityId: OFFICIAL_SITE_CAPABILITY.id,
      capabilityVersion: OFFICIAL_SITE_CAPABILITY.version,
      outputSchemaVersion: OFFICIAL_SITE_CAPABILITY.outputSchemaVersion,
      requestedUrl: requested.toString(),
      finalUrl: finalUrl.toString(),
      accessState: state,
      accessMarkers,
      personalizationDetected: snapshot.personalizationMarkers.length > 0,
      personalizationMarkers: snapshot.personalizationMarkers,
      title: snapshot.title.slice(0, 500),
      ...(snapshot.canonicalUrl ? { canonicalUrl: snapshot.canonicalUrl } : {}),
      ...(snapshot.description ? { description: snapshot.description.slice(0, 2_000) } : {}),
      bodyText,
      bodyTextLength: snapshot.text.length,
      bodyTextTruncated: snapshot.text.length > BODY_TEXT_LIMIT,
      bodyTextSha256: sha256(snapshot.text),
      domLength: snapshot.html.length,
      domSha256: sha256(snapshot.html),
      observedAt: new Date().toISOString(),
    };
  } finally {
    // GEO runs only on a dedicated anonymous profile. Clear site state so one
    // observation cannot personalize the next one and the next attestation can pass.
    await bridge.send('Network.clearBrowserCookies').catch(() => undefined);
    await bridge.send('Network.clearBrowserCache').catch(() => undefined);
    await bridge.send('Fetch.disable').catch(() => undefined);
    await bridge.close().catch(() => undefined);
    await closeTab(endpoint, targetId).catch(() => undefined);
  }
}

export function parseGeoJobOptions(value: unknown): GeoJobOptions {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const input = root['geo'] && typeof root['geo'] === 'object' && !Array.isArray(root['geo'])
    ? root['geo'] as Record<string, unknown> : root;
  const options = {
    capabilityId: String(input['capabilityId'] ?? OFFICIAL_SITE_CAPABILITY.id),
    capabilityVersion: String(input['capabilityVersion'] ?? OFFICIAL_SITE_CAPABILITY.version),
    outputSchemaVersion: String(input['outputSchemaVersion'] ?? OFFICIAL_SITE_CAPABILITY.outputSchemaVersion),
  };
  if (options.capabilityId !== OFFICIAL_SITE_CAPABILITY.id) throw new Error(`不支持的 GEO 能力：${options.capabilityId}`);
  if (options.capabilityVersion !== OFFICIAL_SITE_CAPABILITY.version) throw new Error(`不支持的 GEO 能力版本：${options.capabilityVersion}`);
  if (options.outputSchemaVersion !== OFFICIAL_SITE_CAPABILITY.outputSchemaVersion) throw new Error(`不支持的 GEO 输出版本：${options.outputSchemaVersion}`);
  return options as GeoJobOptions;
}

export function geoCapabilityReady(
  catalog: readonly OpenCliCommand[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return browserProfileKind(env) === 'anonymous'
    && Boolean(env['OPENCLI_CDP_ENDPOINT']?.trim())
    && catalog.some((command) => command.browser === true || ['browser', 'cookie', 'cdp'].includes(command.strategy?.toLowerCase() ?? ''));
}

export async function executeOfficialSiteGeoReport(
  url: string,
  options: unknown,
  observer: OfficialSiteObserver = observeOfficialSite,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AnalysisReport & { geoAcquisition: OfficialSiteObservation; capability: typeof OFFICIAL_SITE_CAPABILITY; geoTrace: { schemaVersion: 1; events: Array<Record<string, unknown>> } }> {
  const startedAt = new Date().toISOString();
  parseGeoJobOptions(options);
  const result = await observer(url, env);
  if (result.personalizationDetected) throw new Error('GEO 观测检测到登录身份，已拒绝保存个性化页面');
  if (result.accessState !== 'accessible') throw new Error(`GEO 页面不可公开观测：${result.accessState}`);
  const item = buildSourceItem({
    platform: 'geo',
    itemType: 'post',
    id: result.domSha256,
    title: result.title || new URL(result.finalUrl).hostname,
    text: [result.title, result.description, result.bodyText].filter(Boolean).join('\n\n'),
    observedAt: result.observedAt,
    author: new URL(result.finalUrl).hostname,
    url: result.finalUrl,
    raw: {
      capabilityId: result.capabilityId,
      capabilityVersion: result.capabilityVersion,
      outputSchemaVersion: result.outputSchemaVersion,
      accessState: result.accessState,
      personalizationDetected: result.personalizationDetected,
      bodyTextLength: result.bodyTextLength,
      bodyTextTruncated: result.bodyTextTruncated,
      bodyTextSha256: result.bodyTextSha256,
      domLength: result.domLength,
      domSha256: result.domSha256,
    },
  });
  return {
    painPoints: [],
    items: [item],
    provenance: {
      providerId: OFFICIAL_SITE_CAPABILITY.id,
      platform: 'geo',
      kind: 'user-authorized',
      mode: 'searchAll',
      fetchedAt: result.observedAt,
      legalBasis: '用户提交的公开官网 URL；匿名浏览器只读观测，并在访问前检查 robots.txt',
      robots: 'checked',
      auth: 'anonymous',
    },
    stats: { totalTexts: 1, clusteredTexts: 0, clusterCount: 0, noiseCount: 0, summarizedClusters: 0, skippedClusters: 0 },
    dataQuality: 'exploratory',
    keyword: url,
    generatedAt: result.observedAt,
    capability: OFFICIAL_SITE_CAPABILITY,
    geoAcquisition: result,
    geoTrace: {
      schemaVersion: 1,
      events: [
        { type: 'validation.started', at: startedAt, url },
        { type: 'robots.checked', at: result.observedAt, result: 'allowed' },
        { type: 'browser.observed', at: result.observedAt, finalUrl: result.finalUrl, accessState: result.accessState },
        { type: 'snapshot.hashed', at: result.observedAt, bodySha256: result.bodyTextSha256, domSha256: result.domSha256 },
      ],
    },
  };
}
