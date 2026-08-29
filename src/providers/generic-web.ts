import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, request } from 'undici';
import { XMLParser } from 'fast-xml-parser';
import { buildSourceItems } from './item.js';
import type {
  AuthMode,
  IDataProvider,
  Platform,
  ProviderCapability,
  RawObservation,
  SearchQuery,
  TextBundle,
} from './types.js';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const SAFE_USER_AGENT = 'ThreadBeaconSourceRuntime/0.7 (+public-read-only)';
const FORBIDDEN_HEADERS = new Set([
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);
const CREDENTIAL_HEADERS = new Set(['authorization', 'x-api-key', 'api-key']);

export interface GenericSourceCursor {
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface GenericFieldMap {
  readonly id?: string;
  readonly title?: string;
  readonly content?: string;
  readonly author?: string;
  readonly url?: string;
  readonly date?: string;
}

export interface GenericSourceConfig {
  readonly url: string;
  readonly itemsPath?: string;
  readonly fields?: GenericFieldMap;
  /** 这里只允许非敏感固定头；凭据必须用 secretHeaders 引用 Worker 环境变量。 */
  readonly headers?: Readonly<Record<string, string>>;
  readonly secretHeaders?: Readonly<Record<string, string>>;
  readonly cursor?: GenericSourceCursor;
}

export interface SafeResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface SafeTransport {
  get(url: string, headers?: Readonly<Record<string, string>>): Promise<SafeResponse>;
}

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
}

function ipv4In(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

/** 公网取数的硬边界：任何本机、私网、链路本地、文档和保留地址都拒绝。 */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const blocked: ReadonlyArray<readonly [string, number]> = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
      ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ];
    return !blocked.some(([base, bits]) => ipv4In(address, base, bits));
  }
  if (isIP(address) !== 6) return false;
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === '::' || value === '::1') return false;
  if (/^(?:fc|fd|fe[89ab]|ff)/.test(value)) return false;
  if (value === '2001:db8::' || value.startsWith('2001:db8:')) return false;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPublicAddress(mapped);
  // 只放行 IANA 全局单播 2000::/3；这也会拒绝十六进制形式的 IPv4-mapped 地址。
  const first = Number.parseInt(value.split(':')[0] ?? '', 16);
  return Number.isFinite(first) && first >= 0x2000 && first <= 0x3fff;
}

export function assertPublicSourceUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('数据源 URL 无效');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('数据源只允许 http/https');
  if (url.username || url.password) throw new Error('数据源 URL 不允许内嵌用户名或密码');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('数据源不能指向本机或局域网主机');
  }
  if (isIP(host) && !isPublicAddress(host)) throw new Error('数据源不能指向私网或保留地址');
  return url;
}

function assertHeaderName(name: string, allowCredential = false): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalized) || FORBIDDEN_HEADERS.has(normalized)) {
    throw new Error(`不允许的数据源请求头：${name}`);
  }
  if (!allowCredential && CREDENTIAL_HEADERS.has(normalized)) {
    throw new Error(`凭据请求头 ${name} 必须通过 secretHeaders 引用环境变量`);
  }
  return normalized;
}

export function resolveSourceHeaders(
  config: GenericSourceConfig,
  env: NodeJS.ProcessEnv = process.env,
): { headers: Record<string, string>; auth: AuthMode } {
  const headers: Record<string, string> = { accept: '*/*', 'user-agent': SAFE_USER_AGENT };
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    const key = assertHeaderName(name);
    if (value.includes('\r') || value.includes('\n')) throw new Error(`请求头 ${name} 包含非法换行`);
    headers[key] = value;
  }
  let auth: AuthMode = 'anonymous';
  for (const [name, envName] of Object.entries(config.secretHeaders ?? {})) {
    const key = assertHeaderName(name, true);
    if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(envName)) throw new Error(`密钥环境变量名无效：${envName}`);
    const value = env[envName];
    if (!value) throw new Error(`Worker 缺少数据源密钥环境变量 ${envName}`);
    headers[key] = value;
    auth = 'app-credential';
  }
  return { headers, auth };
}

async function publicAddresses(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const literal = isIP(hostname);
  const addresses = literal
    ? [{ address: hostname, family: literal as 4 | 6 }]
    : await dnsLookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error(`数据源域名 ${hostname} 没有可用地址`);
  for (const entry of addresses) {
    if (!isPublicAddress(entry.address)) throw new Error(`数据源域名 ${hostname} 解析到了非公网地址`);
  }
  return addresses as Array<{ address: string; family: 4 | 6 }>;
}

async function readLimited(body: AsyncIterable<Uint8Array>, limit: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > limit) throw new Error(`数据源响应超过 ${Math.round(limit / 1024 / 1024)} MiB 上限`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class PinnedSafeTransport implements SafeTransport {
  constructor(
    private readonly timeoutMs = 30_000,
    private readonly maxBytes = MAX_RESPONSE_BYTES,
  ) {}

  async get(input: string, headers: Readonly<Record<string, string>> = {}): Promise<SafeResponse> {
    let current = assertPublicSourceUrl(input);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const addresses = await publicAddresses(current.hostname.replace(/^\[|\]$/g, ''));
      const lookup: LookupFunction = (_hostname, options, callback) => {
        const all = typeof options === 'object' && options.all === true;
        if (all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      };
      const dispatcher = new Agent({ connect: { lookup } });
      try {
        const response = await request(current, {
          method: 'GET',
          headers: { ...headers },
          dispatcher,
          headersTimeout: this.timeoutMs,
          bodyTimeout: this.timeoutMs,
        });
        const responseHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.body.destroy();
          if (redirect === MAX_REDIRECTS) throw new Error('数据源重定向次数过多');
          const location = responseHeaders['location'];
          if (!location) throw new Error('数据源返回重定向但缺少 Location');
          current = assertPublicSourceUrl(new URL(location, current).toString());
          continue;
        }
        return {
          status: response.statusCode,
          url: current.toString(),
          headers: responseHeaders,
          body: await readLimited(response.body, this.maxBytes),
        };
      } finally {
        await dispatcher.close();
      }
    }
    throw new Error('数据源重定向次数过多');
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function atPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    return record(current)?.[key];
  }, value);
}

function first(row: Record<string, unknown>, paths: readonly (string | undefined)[]): unknown {
  for (const path of paths) {
    if (!path) continue;
    const value = atPath(row, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const object = record(value);
  return object ? text(object['#text'] ?? object['__cdata']) : undefined;
}

function date(value: unknown, fallback: Date): string {
  const parsed = typeof value === 'number'
    ? new Date(value < 10_000_000_000 ? value * 1000 : value)
    : new Date(text(value) ?? '');
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

function absoluteUrl(value: unknown, base: string): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try { return new URL(raw, base).toString(); } catch { return undefined; }
}

function observation(
  platform: Platform,
  row: Record<string, unknown>,
  config: GenericSourceConfig,
  baseUrl: string,
  fetchedAt: Date,
): RawObservation | undefined {
  const fields = config.fields ?? {};
  const title = text(first(row, [fields.title, 'title', 'name', 'headline']));
  const content = text(first(row, [fields.content, 'content', 'content:encoded', 'description', 'body', 'text', 'summary']));
  const combined = [title, content].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join('\n\n');
  if (!combined) return undefined;
  const id = text(first(row, [fields.id, 'id', 'guid', 'uuid', '_id']));
  const author = text(first(row, [fields.author, 'author.name', 'author', 'creator', 'dc:creator']));
  const url = absoluteUrl(first(row, [fields.url, 'url', 'link.href', 'link', 'permalink']), baseUrl);
  return {
    platform,
    text: combined,
    observedAt: date(first(row, [fields.date, 'publishedAt', 'published', 'pubDate', 'updated', 'createdAt', 'date']), fetchedAt),
    ...(id ? { id } : {}),
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(url ? { url } : {}),
    raw: row,
  };
}

export function parseRestItems(
  value: unknown,
  config: GenericSourceConfig,
  fetchedAt = new Date(),
): RawObservation[] {
  const selected = atPath(value, config.itemsPath);
  const rows = Array.isArray(selected)
    ? selected
    : Array.isArray(record(selected)?.['items'])
      ? record(selected)!['items'] as unknown[]
      : Array.isArray(record(selected)?.['data'])
        ? record(selected)!['data'] as unknown[]
        : [selected];
  return rows.map(record).filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => observation('rest', row, config, config.url, fetchedAt))
    .filter((item): item is RawObservation => Boolean(item));
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text', cdataPropName: '__cdata' });

export function parseFeedItems(xml: string, config: GenericSourceConfig, fetchedAt = new Date()): RawObservation[] {
  let document: unknown;
  try { document = xmlParser.parse(xml); } catch { throw new Error('RSS/Atom XML 无法解析'); }
  const root = record(document);
  const rows = root?.['rss']
    ? array(record(root['rss'])?.['channel']).flatMap((channel) => array(record(channel)?.['item']))
    : root?.['feed']
      ? array(record(root['feed'])?.['entry'])
      : root?.['rdf:RDF']
        ? array(record(root['rdf:RDF'])?.['item'])
        : [];
  return rows.map(record).filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => observation('rss', row, config, config.url, fetchedAt))
    .filter((item): item is RawObservation => Boolean(item));
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}

export function parseWebPage(html: string, url: string, fetchedAt = new Date()): RawObservation[] {
  const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const content = stripHtml(html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html);
  if (!content) return [];
  return [{ platform: 'web', text: content, title: title || undefined, url, observedAt: fetchedAt, raw: { title } }];
}

export function robotsAllows(content: string, pathname: string, userAgent = 'ThreadBeaconSourceRuntime'): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: (typeof groups)[number] | undefined;
  for (const sourceLine of content.split(/\r?\n/)) {
    const line = sourceLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === 'user-agent') {
      if (!current || current.rules.length > 0) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current && (name === 'allow' || name === 'disallow')) {
      if (value) current.rules.push({ allow: name === 'allow', path: value });
    }
  }
  const ua = userAgent.toLowerCase();
  const matching = groups.filter((group) => group.agents.some((agent) => agent === '*' || ua.includes(agent)));
  const specific = matching.filter((group) => group.agents.some((agent) => agent !== '*' && ua.includes(agent)));
  const rules = (specific.length ? specific : matching).flatMap((group) => group.rules)
    .filter((rule) => pathname.startsWith(rule.path.replace(/\*.*$/, '')))
    .sort((a, b) => b.path.length - a.path.length);
  return rules[0]?.allow ?? true;
}

function substituteUrl(template: string, query: SearchQuery): string {
  return template.replaceAll('{keyword}', encodeURIComponent(query.keyword)).replaceAll('{limit}', String(query.limit));
}

export class GenericSourceProvider implements IDataProvider {
  readonly capability: ProviderCapability;
  private nextCursor: GenericSourceCursor = {};

  constructor(
    private readonly platform: 'rss' | 'rest' | 'web',
    private readonly config: GenericSourceConfig,
    private readonly transport: SafeTransport = new PinnedSafeTransport(),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    assertPublicSourceUrl(config.url);
    const { auth } = resolveSourceHeaders(config, env);
    this.capability = {
      id: `generic-${platform}`,
      platform,
      kind: platform === 'rest' && auth === 'app-credential' ? 'official-api' : 'open-protocol',
      modes: ['searchAll'],
      canFetchComments: false,
      robots: platform === 'web' ? 'checked' : 'not-applicable',
      legalBasis: platform === 'web'
        ? '公开网页，只读访问且逐次遵守 robots.txt'
        : platform === 'rss'
          ? '发布方公开提供的 RSS/Atom 订阅协议'
          : '用户登记的只读 HTTP API；授权与使用条款由数据源所有者负责',
    };
  }

  cursor(): GenericSourceCursor { return { ...this.nextCursor }; }

  private bundle(raws: readonly RawObservation[], auth: AuthMode): TextBundle {
    return {
      items: buildSourceItems(raws),
      provenance: {
        providerId: this.capability.id,
        platform: this.platform,
        kind: this.capability.kind,
        mode: 'searchAll',
        fetchedAt: new Date().toISOString(),
        legalBasis: this.capability.legalBasis,
        robots: this.capability.robots,
        auth,
      },
    };
  }

  async searchAll(query: SearchQuery): Promise<TextBundle> {
    const { headers, auth } = resolveSourceHeaders(this.config, this.env);
    const url = substituteUrl(this.config.url, query);
    if (this.platform === 'rss') {
      if (this.config.cursor?.etag) headers['if-none-match'] = this.config.cursor.etag;
      if (this.config.cursor?.lastModified) headers['if-modified-since'] = this.config.cursor.lastModified;
    }
    if (this.platform === 'web') {
      const target = assertPublicSourceUrl(url);
      const robots = await this.transport.get(new URL('/robots.txt', target.origin).toString(), headers);
      if (robots.status !== 404 && (robots.status < 200 || robots.status >= 300)) {
        throw new Error(`robots.txt 检查失败（HTTP ${robots.status}）`);
      }
      if (robots.status !== 404 && !robotsAllows(robots.body, target.pathname)) {
        throw new Error('robots.txt 不允许采集该页面');
      }
    }
    const response = await this.transport.get(url, headers);
    if (response.status === 304 && this.platform === 'rss') {
      this.nextCursor = { ...this.config.cursor };
      return this.bundle([], auth);
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`数据源请求失败（HTTP ${response.status}）`);
    this.nextCursor = {
      ...(response.headers['etag'] ? { etag: response.headers['etag'] } : {}),
      ...(response.headers['last-modified'] ? { lastModified: response.headers['last-modified'] } : {}),
    };
    const fetchedAt = new Date();
    const raws = this.platform === 'rss'
      ? parseFeedItems(response.body, this.config, fetchedAt)
      : this.platform === 'rest'
        ? (() => {
          try { return parseRestItems(JSON.parse(response.body) as unknown, this.config, fetchedAt); }
          catch (error) { if (error instanceof SyntaxError) throw new Error('REST 数据源返回的不是合法 JSON'); throw error; }
        })()
        : parseWebPage(response.body, response.url, fetchedAt);
    return this.bundle(raws.slice(0, query.limit), auth);
  }

  async checkAvailability(): Promise<boolean> {
    try { await this.searchAll({ keyword: '', limit: 1 }); return true; } catch { return false; }
  }
}
