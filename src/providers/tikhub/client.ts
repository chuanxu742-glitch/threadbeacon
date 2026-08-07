// TikHub 聚合 API 客户端。
//
// TikHub 是第三方数据供应商，一个 token 打通抖音 / TikTok / 小红书 / B站 等平台。
//
// ⚠️ 定性：TikHub 自己的服务条款写明 "TikHub is an unofficial API"。
// 因此接入它的 provider 一律 kind='licensed-vendor'，legalBasis 必须如实写明
// 这一点 —— 不要重复上游 README「官方 API 接口，避免法律风险」那种说法，
// 它与供应商自述矛盾，对外交付时可能构成虚假陈述。见 docs/技术选型调研.md §15。
//
// 计费按次，默认约 $0.001-0.01/次，随端点浮动。分页会成倍烧钱，
// 所以各 provider 的 pageSize 都尽量取端点上限。

import type { HttpPort } from '../http.js';

/** 国际域名。中国大陆网络环境用 api.tikhub.dev。 */
export const TIKHUB_BASE = 'https://api.tikhub.io';
export const TIKHUB_BASE_CN = 'https://api.tikhub.dev';

/** TikHub 的统一响应外壳。业务数据在 data 里，各端点结构不一。 */
export interface TikHubEnvelope<T = unknown> {
  readonly code?: number;
  readonly message?: string;
  readonly data?: T;
}

export class TikHubError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
    readonly path: string,
  ) {
    super(message);
    this.name = 'TikHubError';
  }
}

export interface TikHubClientOptions {
  readonly http: HttpPort;
  readonly apiToken: string;
  /** 覆盖基址。中国大陆用 TIKHUB_BASE_CN。 */
  readonly baseUrl?: string;
}

export class TikHubClient {
  private readonly http: HttpPort;
  private readonly token: string;
  private readonly base: string;

  constructor(opts: TikHubClientOptions) {
    if (!opts.apiToken) {
      throw new Error('TikHubClient 需要 apiToken，见 https://api.tikhub.io/ 获取');
    }
    this.http = opts.http;
    this.token = opts.apiToken;
    this.base = opts.baseUrl ?? TIKHUB_BASE;
  }

  get authMode() {
    return this.http.authMode;
  }

  /**
   * 调一个 TikHub 端点。
   *
   * code 非 200 时抛错而不是返回空 —— 静默返回空会让上层把「配额耗尽」
   * 与「该关键词没结果」当成同一件事，那是最难排查的一类故障。
   */
  async get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const res = await this.http.getJson<TikHubEnvelope<T>>(url.toString(), {
      authorization: `Bearer ${this.token}`,
      accept: 'application/json',
    });

    if (res.code !== undefined && res.code !== 200) {
      throw new TikHubError(
        `TikHub ${path} 返回 code=${res.code}${res.message ? `：${res.message}` : ''}`,
        res.code,
        path,
      );
    }
    return res.data as T;
  }
}

/**
 * 从嵌套响应里取出条目数组。
 *
 * TikHub 各端点的层级不一致：小红书是 data.items，B站是 data.result，
 * 抖音/TikTok 有时是 data.data 有时是 data。上游 SeekMoney-ai 对此写了
 * 多层 fallback（tikhub-service.ts:101-109），这里沿用同样的兜底策略 ——
 * 该结构未在文档中固定，硬编码单一路径会在端点调整时静默返回空。
 */
export function pickArray(source: unknown, ...keys: readonly string[]): unknown[] {
  if (Array.isArray(source)) return source;
  if (typeof source !== 'object' || source === null) return [];

  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const v = obj[key];
    if (Array.isArray(v)) return v;
  }
  // 再往下钻一层：data.data.data 这种形态确实存在
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'object' && v !== null) {
      const nested = pickArray(v, ...keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/** 秒级时间戳转 ISO。各中国平台普遍用秒，JS 用毫秒，这个转换忘一次就整批时间错位。 */
export function fromUnixSeconds(sec: unknown): string | undefined {
  const n = typeof sec === 'number' ? sec : Number(sec);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n * 1000).toISOString();
}

/** 去掉搜索结果标题里的高亮标签。B站的 title 带 <em class="keyword"> 包裹。 */
export function stripHtml(s: unknown): string {
  return typeof s === 'string' ? s.replace(/<[^>]*>/g, '') : '';
}

/** 安全取字符串。 */
export function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

/** 安全取数字。各平台的计数字段有的是 number 有的是 string。 */
export function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
