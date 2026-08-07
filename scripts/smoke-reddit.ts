#!/usr/bin/env -S npx tsx
// Reddit 链路冒烟验证 —— 用真实凭据跑一次 provider 取数。
//
//   pnpm smoke:reddit ["关键词"] [limit]
//
// 覆盖范围（README「下一步」第 1 条）：
//   OAuth client_credentials 换 token -> /search 分页 -> 字段提取 -> provenance
//
// 刻意不接 embedding 与 LLM：那两段各有独立的失败模式和 API 成本，
// 混在一起跑时任何一处报错都要重新二分定位，而取数层的问题最难事后复现。
//
// 脚本对 provider 只做黑盒观测：把 HttpPort 包一层记录调用，
// 从而能验证「分页确实翻了页」与「限流确实等了」，而不是只看最终条数。

import { loadEnvFiles } from '../src/env.js';
import { configureProxyFromEnv } from '../src/net/proxy.js';
import { PoliteHttpClient, type AuthMode, type HttpPort } from '../src/providers/http.js';
import { RedditProvider } from '../src/providers/reddit.js';
import type { SourceItem, TextBundle } from '../src/providers/types.js';

const env = process.env;

// ---------------------------------------------------------------------------
// 观测层
// ---------------------------------------------------------------------------

interface Call {
  readonly method: string;
  readonly url: string;
  readonly host: string;
  /** 发起时刻。串行调用下，同 host 相邻两次的差值可用来判断限流是否生效。 */
  readonly at: number;
}

/** 透明代理 HttpPort，只记录调用，不改变任何行为。 */
class ObservingHttp implements HttpPort {
  readonly calls: Call[] = [];

  constructor(private readonly inner: HttpPort) {}

  get authMode(): AuthMode {
    return this.inner.authMode;
  }

  private record(method: string, url: string): void {
    this.calls.push({ method, url, host: new URL(url).host, at: Date.now() });
  }

  async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    this.record('GET', url);
    return this.inner.getJson<T>(url, headers);
  }

  async postForm<T>(
    url: string,
    body: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<T> {
    this.record('POST', url);
    return this.inner.postForm<T>(url, body, headers);
  }
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

type Level = 'pass' | 'fail' | 'warn' | 'info';
const results: Array<{ level: Level; label: string; detail: string }> = [];

function check(ok: boolean, label: string, detail = ''): void {
  results.push({ level: ok ? 'pass' : 'fail', label, detail });
}
function warn(label: string, detail = ''): void {
  results.push({ level: 'warn', label, detail });
}
function info(label: string, detail = ''): void {
  results.push({ level: 'info', label, detail });
}

// ---------------------------------------------------------------------------
// 字段提取覆盖率
// ---------------------------------------------------------------------------

/**
 * 逐个字段统计有多少条记录成功提取到值。
 *
 * 覆盖率低不一定是 bug —— Reddit 的已删除用户 author 会是 "[deleted]"、
 * 纯链接帖 selftext 为空 —— 但突然掉到 0 通常意味着上游改了字段名。
 */
const TRACKED = ['id', 'author', 'authorId', 'url', 'title'] as const;

function coverage(items: readonly SourceItem[]): Array<[string, number]> {
  return TRACKED.map((k) => [k, items.filter((it) => it[k] !== undefined).length]);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function preview(text: string, max = 110): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

async function main(): Promise<number> {
  const files = loadEnvFiles();
  const proxy = await configureProxyFromEnv(env);

  const keyword = process.argv[2] ?? 'battery life';
  const limit = Number.parseInt(process.argv[3] ?? '120', 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`limit 必须是正整数，收到 "${process.argv[3]}"`);
    return 2;
  }

  console.log('=== Reddit 链路冒烟 ===');
  console.log(`配置来源：${files.length ? files.join(' + ') : '仅系统环境变量'}`);
  console.log(`代理：${proxy ?? '未配置'}`);
  console.log(`关键词："${keyword}"    limit：${limit}\n`);

  const id = env['REDDIT_CLIENT_ID'];
  const secret = env['REDDIT_CLIENT_SECRET'];
  if (!id || !secret) {
    console.error(
      '缺少 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET。\n' +
        '在 https://www.reddit.com/prefs/apps 创建 "script" 类型应用，' +
        '把 id 与 secret 写进仓库根目录的 .env.local。',
    );
    return 2;
  }

  const http = new ObservingHttp(new PoliteHttpClient({ authMode: 'app-credential' }));
  const provider = new RedditProvider({
    http,
    clientId: id,
    clientSecret: secret,
    ...(env['REDDIT_USER_AGENT'] ? { userAgent: env['REDDIT_USER_AGENT'] } : {}),
  });

  const t0 = Date.now();
  let bundle: TextBundle;
  try {
    bundle = await provider.searchAll({ keyword, limit });
  } catch (e) {
    console.error(`\n取数失败：${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    console.error(diagnose(e, http));
    return 1;
  }
  const elapsed = Date.now() - t0;

  // --- 取数结果 ---
  const items = bundle.items;
  check(items.length > 0, '取到数据', `${items.length} 条，耗时 ${elapsed}ms`);
  check(items.length <= limit, '不超过 limit', `${items.length} <= ${limit}`);

  // --- 调用轨迹：token 一次，search 若干次 ---
  const tokenCalls = http.calls.filter((c) => c.host === 'www.reddit.com');
  const searchCalls = http.calls.filter((c) => c.host === 'oauth.reddit.com');
  check(tokenCalls.length === 1, 'OAuth token 只换一次（有缓存）', `${tokenCalls.length} 次`);
  info('search 请求次数', `${searchCalls.length} 次`);

  const afters = searchCalls.map((c) => new URL(c.url).searchParams.get('after')).slice(1);
  if (searchCalls.length > 1) {
    check(
      afters.every((a) => a !== null && a !== ''),
      '分页游标已透传',
      `after=${afters.map((a) => a ?? 'null').join(', ')}`,
    );
  } else {
    warn('未触发分页', `只发了 1 次 search，limit=${limit} 可能已被单页满足或结果不足`);
  }

  // --- 限流：同 host 相邻请求间隔 ---
  const gaps: number[] = [];
  for (let i = 1; i < searchCalls.length; i++) {
    gaps.push(searchCalls[i]!.at - searchCalls[i - 1]!.at);
  }
  if (gaps.length > 0) {
    const min = Math.min(...gaps);
    check(min >= 1000, '限流生效（同 host >= 1s）', `最小间隔 ${min}ms，全部：${gaps.join(', ')}ms`);
  }

  // --- provenance ---
  const p = bundle.provenance;
  check(p.auth === 'app-credential', "provenance.auth = 'app-credential'", p.auth);
  check(p.kind === 'official-api', "provenance.kind = 'official-api'", p.kind);
  check(p.mode === 'searchAll', "provenance.mode = 'searchAll'", p.mode);
  check(p.platform === 'reddit', "provenance.platform = 'reddit'", p.platform);
  check(p.robots === 'not-applicable', "provenance.robots = 'not-applicable'", p.robots);
  check(p.legalBasis.length > 0, 'provenance.legalBasis 非空', preview(p.legalBasis, 60));

  // --- SourceItem 结构 ---
  const badTime = items.filter((it) => Number.isNaN(Date.parse(it.postedAt)));
  check(badTime.length === 0, 'postedAt 均可解析', `${new Set(items.map((i) => i.timeBucket)).size} 个不同日期`);
  check(
    items.every((it) => it.itemType === 'post'),
    'itemType 均为 post',
    'Reddit provider 当前只取帖子',
  );

  // --- 字段提取覆盖率 ---
  for (const [field, n] of coverage(items)) {
    const pct = items.length ? Math.round((n / items.length) * 100) : 0;
    // url 与 id 应当条条都有；author 可能是 [deleted]，title 纯链接帖也可能缺
    const required = field === 'id' || field === 'url';
    if (required) {
      check(n === items.length, `${field} 提取完整`, `${n}/${items.length}`);
    } else {
      info(`${field} 覆盖率`, `${n}/${items.length} (${pct}%)`);
    }
  }

  // --- 输出 ---
  console.log('--- 检查项 ---');
  const icon: Record<Level, string> = { pass: '[PASS]', fail: '[FAIL]', warn: '[WARN]', info: '[INFO]' };
  for (const r of results) {
    console.log(`${icon[r.level]} ${r.label}${r.detail ? `  ->  ${r.detail}` : ''}`);
  }

  console.log('\n--- 样本（前 3 条）---');
  for (const it of items.slice(0, 3)) {
    console.log(`  [${it.timeBucket}] u/${it.author ?? '?'}  ${preview(it.text, 80)}`);
    console.log(`      ${it.url ?? '(无链接)'}`);
  }

  const failed = results.filter((r) => r.level === 'fail').length;
  const warned = results.filter((r) => r.level === 'warn').length;
  console.log(
    `\n结论：${failed === 0 ? '链路跑通' : `${failed} 项未通过`}` +
      `${warned ? `，${warned} 项告警` : ''}`,
  );
  return failed === 0 ? 0 : 1;
}

/** 把常见失败翻译成可操作的下一步，而不是让使用者对着 HTTP 码猜。 */
function diagnose(e: unknown, http: ObservingHttp): string {
  const msg = e instanceof Error ? e.message : String(e);
  const reachedSearch = http.calls.some((c) => c.host === 'oauth.reddit.com');

  if (msg.includes('access_token') || msg.includes('401')) {
    return (
      '排查：client_id / client_secret 不正确，或应用类型不是 "script"。\n' +
      'Reddit 的 client_id 是应用名下方那串短字符串（不是应用名本身），' +
      'secret 是标着 "secret" 的那一行。'
    );
  }
  if (msg.includes('403')) {
    return reachedSearch
      ? '排查：token 换到了但 /search 被拒。检查应用是否被封禁，以及 User-Agent 是否符合 Reddit 要求。'
      : '排查：token 端点就被拒。Reddit 对缺失或可疑 User-Agent 会直接 403，' +
          '在 .env.local 里设 REDDIT_USER_AGENT=caiji/0.1 (by /u/你的用户名)。';
  }
  if (msg.includes('429')) {
    return '排查：触发限流。免费档 100 QPM/client，稍后重试；不要靠并发或换 IP 绕过。';
  }
  if (msg.includes('TimeoutError') || msg.includes('fetch failed')) {
    return '排查：网络不可达。设置 HTTPS_PROXY 后重试（.env.local 里也可以写）。';
  }
  return '排查：先跑 pnpm doctor 确认可达性与凭据配置。';
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  });
