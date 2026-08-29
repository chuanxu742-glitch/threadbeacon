import { createHash } from 'node:crypto';
import { CDPBridge } from '@jackwener/opencli/browser/cdp';

export type BrowserProfileKind = 'anonymous' | 'authenticated';

export interface BrowserProfileAttestation {
  schemaVersion: 1;
  profileName: string;
  profileKind: BrowserProfileKind;
  verified: boolean;
  cookieCount: number | null;
  targetCount: number | null;
  browserFingerprint: string | null;
  checkedAt: string;
  expiresAt: string;
  error?: string;
}

const ATTESTATION_TTL_MS = 75_000;

export function browserProfileKind(env: NodeJS.ProcessEnv = process.env): BrowserProfileKind {
  const explicit = env['THREADBEACON_BROWSER_PROFILE_KIND']?.trim().toLowerCase();
  if (explicit && !['anonymous', 'authenticated'].includes(explicit)) throw new RangeError('THREADBEACON_BROWSER_PROFILE_KIND 只允许 anonymous 或 authenticated');
  return explicit === 'anonymous' || (!explicit && env['THREADBEACON_BROWSER_PROFILE']?.trim().toLowerCase() === 'anonymous') ? 'anonymous' : 'authenticated';
}

export function browserProfileName(env: NodeJS.ProcessEnv = process.env): string {
  return (env['THREADBEACON_BROWSER_PROFILE_NAME']?.trim() || env['THREADBEACON_BROWSER_PROFILE']?.trim() || browserProfileKind(env)).slice(0, 100);
}

function endpoint(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('OPENCLI_CDP_ENDPOINT 必须是无内嵌凭据的 http/https URL');
  return url.toString().replace(/\/$/, '');
}

function shortError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 300);
}

function times(now = new Date()) {
  return { checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ATTESTATION_TTL_MS).toISOString() };
}

export function unavailableBrowserAttestation(kind: BrowserProfileKind, error: unknown, now = new Date()): BrowserProfileAttestation {
  return { schemaVersion: 1, profileName: kind, profileKind: kind, verified: false, cookieCount: null, targetCount: null, browserFingerprint: null, ...times(now), error: shortError(error) };
}

/**
 * Ask the browser-level CDP endpoint for its complete cookie jar. An anonymous
 * profile is attested only when the endpoint is reachable and the jar is empty.
 * The signed Worker heartbeat is the trust boundary; no CDP URL is persisted.
 */
export async function attestBrowserProfile(env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<BrowserProfileAttestation> {
  const kind = browserProfileKind(env);
  const profileName = browserProfileName(env);
  const rawEndpoint = env['OPENCLI_CDP_ENDPOINT']?.trim();
  if (!rawEndpoint) return { ...unavailableBrowserAttestation(kind, 'OPENCLI_CDP_ENDPOINT 未配置', now), profileName };
  const base = endpoint(rawEndpoint);
  try {
    const response = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
    const version = await response.json() as { webSocketDebuggerUrl?: unknown; Browser?: unknown; 'Protocol-Version'?: unknown };
    if (typeof version.webSocketDebuggerUrl !== 'string') throw new Error('CDP 未返回浏览器级 WebSocket 地址');
    const bridge = new CDPBridge();
    try {
      await bridge.connect({ cdpEndpoint: version.webSocketDebuggerUrl, timeout: 10 });
      const cookieReply = await bridge.send('Storage.getCookies') as { cookies?: unknown[] };
      const targetReply = await bridge.send('Target.getTargets') as { targetInfos?: unknown[] };
      const cookieCount = Array.isArray(cookieReply.cookies) ? cookieReply.cookies.length : 0;
      const targetCount = Array.isArray(targetReply.targetInfos) ? targetReply.targetInfos.length : 0;
      const fingerprintSource = `${String(version.Browser ?? '')}|${String(version['Protocol-Version'] ?? '')}|${new URL(base).hostname}`;
      return {
        schemaVersion: 1,
        profileName,
        profileKind: kind,
        verified: kind === 'authenticated' || cookieCount === 0,
        cookieCount,
        targetCount,
        browserFingerprint: createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 24),
        ...times(now),
        ...(kind === 'anonymous' && cookieCount > 0 ? { error: `匿名 Profile 检测到 ${cookieCount} 个 Cookie` } : {}),
      };
    } finally {
      await bridge.close().catch(() => undefined);
    }
  } catch (error) {
    return { ...unavailableBrowserAttestation(kind, error, now), profileName };
  }
}

export function isFreshAnonymousAttestation(value: unknown, at = Date.now()): value is BrowserProfileAttestation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item['schemaVersion'] === 1 && item['profileKind'] === 'anonymous' && item['verified'] === true
    && item['cookieCount'] === 0 && typeof item['expiresAt'] === 'string' && Date.parse(item['expiresAt']) > at;
}
