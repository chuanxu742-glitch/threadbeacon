export const BROWSER_ACTION_TYPES = [
  'session.create','session.close','tabs.list','tabs.open','tabs.close',
  'navigate','snapshot','click','type','screenshot',
] as const;

export type BrowserActionType = typeof BROWSER_ACTION_TYPES[number];

export interface BrowserActionCommand {
  readonly id: string;
  readonly sessionId: string;
  readonly type: BrowserActionType;
  readonly timeoutMs: number;
  readonly targetId?: string | null;
  readonly allowedTargetIds?: readonly string[];
  readonly allowlist: readonly string[];
  readonly input: Readonly<Record<string, unknown>>;
}

export interface BrowserTab {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly type: string;
}

export interface BrowserActionResult {
  readonly capability: 'cdp';
  readonly status: 'completed';
  readonly targetId?: string;
  readonly tabs?: readonly BrowserTab[];
  readonly snapshot?: readonly Readonly<Record<string, unknown>>[];
  readonly screenshotBase64?: string;
  readonly screenshotMime?: 'image/png' | 'image/jpeg';
  readonly detail?: Readonly<Record<string, unknown>>;
}

export function isBrowserActionType(value: unknown): value is BrowserActionType {
  return typeof value === 'string' && (BROWSER_ACTION_TYPES as readonly string[]).includes(value);
}
