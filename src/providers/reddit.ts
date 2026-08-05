// Reddit provider —— 官方 Data API。
//
// 走 OAuth client_credentials 拿应用级 token，不涉及任何用户身份，
// 因而 authMode 是 'app-credential' 而非登录态采集。
//
// ⚠️ 计费与授权：免费档（100 QPM / client）**仅限非商业用途**。
// 商用需与 Reddit 签约（约 $0.24/1k 次，起步 $12,000/月，审批 2–4 周），
// 或申请 Official Data Partner。用免费档做商业产品直接违反 TOS。
// 见 docs/行业合规范式.md §2。

import { BaseProvider, paginate, type BaseProviderDeps } from './base.js';
import type { RawObservation } from '../privacy/minimize.js';
import type { ProviderCapability, SearchQuery, TextBundle } from './types.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const PAGE_SIZE = 100; // listing 单页上限
/** token 提前过期的安全余量，避免边界上用到刚失效的 token。 */
const TOKEN_SKEW_MS = 60_000;

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
}

interface ListingResponse {
  readonly data?: {
    readonly after?: string | null;
    readonly children?: ReadonlyArray<{
      readonly data?: {
        readonly title?: string;
        readonly selftext?: string;
        readonly created_utc?: number;
      };
    }>;
  };
}

export interface RedditProviderOptions extends BaseProviderDeps {
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * Reddit 要求带可识别的 User-Agent，格式建议 `platform:appid:version (by /u/name)`。
   * 缺省值能用，但生产环境应换成你自己的标识。
   */
  readonly userAgent?: string;
  /** 授权依据说明，会写进每条数据的 provenance。商用签约后应改成合同标识。 */
  readonly legalBasis?: string;
}

export class RedditProvider extends BaseProvider {
  readonly capability: ProviderCapability;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly userAgent: string;
  private token: { value: string; expiresAt: number } | undefined;

  constructor(opts: RedditProviderOptions) {
    super(opts);
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.userAgent = opts.userAgent ?? 'caiji/0.1 (https://github.com/)';
    this.capability = {
      id: 'reddit-official-api',
      platform: 'reddit',
      kind: 'official-api',
      modes: ['searchAll'],
      canFetchComments: false,
      legalBasis:
        opts.legalBasis ??
        'Reddit Data API，OAuth client_credentials 应用级授权。免费档仅限非商业用途，商用须另行签约',
      robots: 'not-applicable', // 走官方 API 端点，非网页爬取
      quota: { unit: 'requests', note: '免费档 100 QPM/client；商用约 $0.24/1k 次' },
    };
  }

  /** 取 access token，带缓存。client_credentials 不涉及任何用户身份。 */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.value;

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.http.postForm<TokenResponse>(
      TOKEN_URL,
      { grant_type: 'client_credentials' },
      { authorization: `Basic ${basic}`, 'user-agent': this.userAgent },
    );

    if (!res.access_token) {
      throw new Error('Reddit 未返回 access_token，请检查 clientId / clientSecret');
    }
    this.token = {
      value: res.access_token,
      expiresAt: now + (res.expires_in ?? 3600) * 1000 - TOKEN_SKEW_MS,
    };
    return this.token.value;
  }

  async searchAll(query: SearchQuery): Promise<TextBundle> {
    const token = await this.accessToken();
    const headers = { authorization: `Bearer ${token}`, 'user-agent': this.userAgent };

    const posts = await paginate<RawObservation>(query.limit, PAGE_SIZE, async (after, want) => {
      const url = new URL('/search', API_BASE);
      url.searchParams.set('q', query.keyword);
      url.searchParams.set('limit', String(want));
      url.searchParams.set('sort', 'relevance');
      url.searchParams.set('type', 'link');
      if (after !== undefined) url.searchParams.set('after', after);

      const res = await this.http.getJson<ListingResponse>(url.toString(), headers);

      const items: RawObservation[] = [];
      for (const child of res.data?.children ?? []) {
        const d = child.data;
        if (!d || d.created_utc === undefined) continue;
        // 标题与正文合成一条：分析层要的是语义，不是版式
        const text = [d.title, d.selftext].filter((s): s is string => !!s?.trim()).join('\n\n');
        if (!text) continue;
        items.push({
          text,
          observedAt: new Date(d.created_utc * 1000),
          platform: 'reddit',
        });
      }
      const next = res.data?.after;
      return { items, ...(next ? { cursor: next } : {}) };
    });

    return this.bundle(posts, 'searchAll');
  }
}
