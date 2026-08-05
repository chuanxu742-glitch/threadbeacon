// 受约束的 HTTP 客户端。
//
// 依据 docs/GDPR架构边界.md §7.3 与 docs/技术选型调研.md §17.1。
//
// 核心保证：本客户端在物理上无法发出携带身份凭据的请求。
// Meta v. Bright Data 的胜诉理由是「登出状态」，Meta v. Voyager Labs 的败诉原因是登录态 ——
// 这条边界不能靠自觉，要靠代码。

/** 一律剥离的请求头，不区分大小写。 */
const FORBIDDEN_HEADERS = new Set(['cookie', 'authorization', 'x-csrf-token', 'set-cookie']);

export class AuthenticatedRequestError extends Error {
  constructor(header: string) {
    super(
      `拒绝发送带 "${header}" 头的请求。本项目不做登录态采集，见 docs/GDPR架构边界.md §7.3。`,
    );
    this.name = 'AuthenticatedRequestError';
  }
}

export class RateLimitedError extends Error {
  constructor(
    readonly status: number,
    readonly host: string,
  ) {
    super(`${host} 返回 ${status}，已触发熔断。不得通过并发或换 IP 绕过限流。`);
    this.name = 'RateLimitedError';
  }
}

export interface HttpOptions {
  /** 同一 host 两次请求之间的最小间隔（毫秒）。默认 1000，即 ≤1 QPS/host。 */
  readonly minIntervalMs?: number;
  /** 遇 429/403 后的最大重试次数。默认 3。 */
  readonly maxRetries?: number;
  /** 退避基数（毫秒）。默认 2000。 */
  readonly backoffBaseMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 全局按 host 串行化的限流器。
 *
 * 用「上次请求时间」而非令牌桶，是因为采集场景要的是平滑节流，
 * 而令牌桶允许突发 —— 突发正是触发风控和「影响服务可用性」认定的原因。
 */
export class PolitePool {
  private readonly lastAt = new Map<string, number>();
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(private readonly minIntervalMs: number) {}

  /** 把 fn 排进该 host 的串行队列，并保证与上一次调用间隔足够。 */
  async schedule<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chain.get(host) ?? Promise.resolve();
    const run = prev.then(async () => {
      const last = this.lastAt.get(host);
      if (last !== undefined) {
        const wait = this.minIntervalMs - (Date.now() - last);
        if (wait > 0) await sleep(wait);
      }
      this.lastAt.set(host, Date.now());
      return fn();
    });
    // 队列不因单次失败而断裂
    this.chain.set(
      host,
      run.catch(() => undefined),
    );
    return run;
  }
}

export class PoliteHttpClient {
  private readonly pool: PolitePool;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(opts: HttpOptions = {}) {
    this.pool = new PolitePool(opts.minIntervalMs ?? 1000);
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 2000;
  }

  /** 校验调用方没有试图携带凭据。发现即抛错，不静默剥离 —— 静默会掩盖设计错误。 */
  private assertNoCredentials(headers: Record<string, string>): void {
    for (const key of Object.keys(headers)) {
      if (FORBIDDEN_HEADERS.has(key.toLowerCase())) {
        throw new AuthenticatedRequestError(key);
      }
    }
  }

  async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    this.assertNoCredentials(headers);
    const host = new URL(url).host;

    for (let attempt = 0; ; attempt++) {
      const res = await this.pool.schedule(host, () =>
        fetch(url, {
          headers: { ...headers, accept: 'application/json' },
          // 明确禁止 cookie 参与，即使运行时默认行为变化也不受影响
          credentials: 'omit',
          redirect: 'follow',
        }),
      );

      if (res.status === 429 || res.status === 403) {
        if (attempt >= this.maxRetries) throw new RateLimitedError(res.status, host);
        await sleep(this.backoffBaseMs * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        throw new Error(`GET ${url} 失败：HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    }
  }
}
