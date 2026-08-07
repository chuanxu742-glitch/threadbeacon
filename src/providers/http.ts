// 受约束的 HTTP 客户端。
//
// 依据 docs/GDPR架构边界.md §7.3 与 docs/技术选型调研.md §17.1。
//
// 核心区分：**用户会话凭据**与**应用级凭据**是两回事，不能一并禁掉。
//   - Cookie 是用户会话标记 —— 任何模式下一律拒绝。
//     Meta v. Voyager Labs 因登录态 + 假账号被判永久禁令，
//     Meta v. Bright Data 因「登出抓公开数据」胜诉，边界就在这里。
//   - Authorization 携带的是平台签发给应用的凭据（Reddit OAuth、各类 API key）。
//     官方 API 恰恰是最合规的取数路径，禁掉它等于只剩爬取，方向反了。
//
// 因此凭据策略按 AuthMode 分档，而不是一刀切。

/**
 * 取数时使用的凭据档位。
 *
 * 注意 'user-session' 是**声明**用的，不是放行开关：
 * PoliteHttpClient 在任何档位下都拒发 Cookie，这条没有改变。
 * 该档位只出现在 provenance 里，用于如实标记「这批数据来自使用了登录态的
 * 外部工具」（见 providers/external.ts）—— 审计时必须能把它与官方 API
 * 采到的数据区分开，含糊记录比不记录更糟。
 */
export type AuthMode =
  /** 不带任何凭据。开放协议与公开页面走这档。 */
  | 'anonymous'
  /** 平台签发给应用的凭据（OAuth client credentials、API key）。官方 API 走这档。 */
  | 'app-credential'
  /**
   * 终端用户以自有账号登录后产生的会话凭据，由外部工具持有并使用。
   *
   * 与 Meta v. Voyager Labs 的区别在于账号归属：那案子是登录态 + **假账号**，
   * 这里是运行者自己的真实账号。二者不同，但也不等同于「登出抓公开数据」，
   * 风险介于两者之间，由部署者承担（见 DISCLAIMER.md §1）。
   */
  | 'user-session';

/** 任何模式下都不允许出现的请求头。均为用户会话标记。 */
const SESSION_HEADERS = new Set(['cookie', 'set-cookie', 'x-csrf-token']);
/** 仅 app-credential 模式允许的请求头。 */
const CREDENTIAL_HEADERS = new Set(['authorization']);

export class SessionCredentialError extends Error {
  constructor(header: string) {
    super(
      `拒绝发送带 "${header}" 头的请求：这是用户会话凭据，本项目不做登录态采集。` +
        `官方 API 的应用级凭据请用 authMode: 'app-credential' + Authorization 头。`,
    );
    this.name = 'SessionCredentialError';
  }
}

export class UnexpectedCredentialError extends Error {
  constructor(header: string) {
    super(
      `当前 authMode 为 'anonymous'，不应出现 "${header}" 头。` +
        `若该数据源确实走官方授权，请在 provider 中显式声明 authMode: 'app-credential'。`,
    );
    this.name = 'UnexpectedCredentialError';
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

/**
 * 403：被拒绝，不是被限流。
 *
 * 早期版本把 403 和 429 一起塞进重试退避，这是误诊 ——
 * 403 多数意味着该端点需要授权、或凭据不足，重试同一个请求三次只会白等，
 * 最后还报成「限流」误导排查方向。二者必须分开。
 */
export class ForbiddenError extends Error {
  constructor(
    readonly host: string,
    readonly url: string,
  ) {
    super(
      `${host} 返回 403（拒绝，非限流）：${url}\n` +
        `常见原因：该端点需要授权而当前为匿名调用；或应用凭据无此权限。\n` +
        `若确认该数据源需要平台签发的应用级凭据，请在 provider 中改用 ` +
        `authMode: 'app-credential' 并提供凭据；若它需要的是用户账号凭据，` +
        `本项目不支持该数据源（见 DISCLAIMER.md §1）。`,
    );
    this.name = 'ForbiddenError';
  }
}

export interface HttpOptions {
  /** 凭据档位，默认 'anonymous'。 */
  readonly authMode?: AuthMode;
  /** 同一 host 两次请求之间的最小间隔（毫秒）。默认 1000，即 ≤1 QPS/host。 */
  readonly minIntervalMs?: number;
  /** 遇 429 后的最大重试次数。默认 3。403 不重试。 */
  readonly maxRetries?: number;
  /** 退避基数（毫秒）。默认 2000。 */
  readonly backoffBaseMs?: number;
  /**
   * 单次请求超时（毫秒）。默认 30000。
   *
   * 没有超时会很难受：部分网络环境下目标主机 DNS 能解析但 TCP 不通，
   * 请求会一直挂着而不是快速失败。
   */
  readonly timeoutMs?: number;
}

// 代理不在这一层处理 —— 它是进程级配置，见 src/net/proxy.ts。

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

/** provider 依赖的最小 HTTP 能力面。测试注入假实现，生产用 PoliteHttpClient。 */
export interface HttpPort {
  readonly authMode: AuthMode;
  getJson<T>(url: string, headers?: Record<string, string>): Promise<T>;
  postForm<T>(
    url: string,
    body: Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<T>;
}

export class PoliteHttpClient implements HttpPort {
  readonly authMode: AuthMode;

  private readonly pool: PolitePool;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;

  constructor(opts: HttpOptions = {}) {
    this.authMode = opts.authMode ?? 'anonymous';
    this.pool = new PolitePool(opts.minIntervalMs ?? 1000);
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private send(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      // 明确禁止 cookie 参与，即使运行时默认行为变化也不受影响
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  /**
   * 校验请求头。发现越界即抛错，不静默剥离 —— 静默会掩盖设计错误，
   * 让调用方误以为自己在带凭据取数。
   */
  private assertHeadersAllowed(headers: Record<string, string>): void {
    for (const key of Object.keys(headers)) {
      const k = key.toLowerCase();
      if (SESSION_HEADERS.has(k)) throw new SessionCredentialError(key);
      if (CREDENTIAL_HEADERS.has(k) && this.authMode !== 'app-credential') {
        throw new UnexpectedCredentialError(key);
      }
    }
  }

  async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    this.assertHeadersAllowed(headers);
    const host = new URL(url).host;

    for (let attempt = 0; ; attempt++) {
      const res = await this.pool.schedule(host, () =>
        this.send(url, { headers: { ...headers, accept: 'application/json' } }),
      );

      // 403 不重试：它是「被拒绝」而非「太快了」，重试同一个请求不会变成 200
      if (res.status === 403) throw new ForbiddenError(host, url);

      if (res.status === 429 || res.status === 503) {
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

  /** 表单 POST，仅用于 OAuth token 交换这类场景。 */
  async postForm<T>(
    url: string,
    body: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<T> {
    this.assertHeadersAllowed(headers);
    const host = new URL(url).host;

    const res = await this.pool.schedule(host, () =>
      this.send(url, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams(body).toString(),
      }),
    );

    if (res.status === 403) throw new ForbiddenError(host, url);
    if (res.status === 429 || res.status === 503) {
      throw new RateLimitedError(res.status, host);
    }
    if (!res.ok) {
      throw new Error(`POST ${url} 失败：HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
