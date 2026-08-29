import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ForbiddenError,
  PoliteHttpClient,
  RateLimitedError,
  TransientHttpError,
  redactUrl,
  retryAfterMs,
} from '../src/providers/http.js';

/** 按序返回预置状态码的 fetch 替身。 */
function stubFetch(statuses: number[], body: unknown = { ok: true }) {
  let i = 0;
  const calls = { count: 0 };
  vi.stubGlobal('fetch', async () => {
    calls.count += 1;
    const status = statuses[Math.min(i++, statuses.length - 1)]!;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('403 与 429 必须分开处理', () => {
  it('403 立即抛 ForbiddenError，不重试', async () => {
    const calls = stubFetch([403]);
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 0, minIntervalMs: 0 });

    await expect(http.getJson('https://example.com/x')).rejects.toThrow(ForbiddenError);
    // 关键：只发一次。403 是「被拒绝」，重试同一个请求不会变成 200
    expect(calls.count).toBe(1);
  });

  it('403 不会被误报成限流，且错误信息指向排查方向', async () => {
    stubFetch([403]);
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 0, minIntervalMs: 0 });

    // 语义断言：403 永远不该是 RateLimitedError —— 早期版本正是这样误诊的
    await expect(http.getJson('https://example.com/x')).rejects.not.toThrow(RateLimitedError);
    await expect(http.getJson('https://example.com/x')).rejects.toThrow(/需要授权|凭据/);
  });

  it('429 才走退避重试，超出次数后报 RateLimitedError', async () => {
    const calls = stubFetch([429]);
    const http = new PoliteHttpClient({ maxRetries: 2, backoffBaseMs: 0, minIntervalMs: 0 });

    await expect(http.getJson('https://example.com/x')).rejects.toThrow(RateLimitedError);
    expect(calls.count).toBe(3); // 首次 + 2 次重试
  });

  it('429 后恢复则正常返回', async () => {
    stubFetch([429, 200], { hello: 'world' });
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 0, minIntervalMs: 0 });

    await expect(http.getJson<{ hello: string }>('https://example.com/x')).resolves.toEqual({
      hello: 'world',
    });
  });

  it('503 视同过载，走重试', async () => {
    const calls = stubFetch([503, 200], { ok: 1 });
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 0, minIntervalMs: 0 });

    await http.getJson('https://example.com/x');
    expect(calls.count).toBe(2);
  });

  it('其他 4xx 直接报错且不重试', async () => {
    const calls = stubFetch([404]);
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 0, minIntervalMs: 0 });

    await expect(http.getJson('https://example.com/x')).rejects.toThrow(/HTTP 404/);
    expect(calls.count).toBe(1);
  });
});

describe('暂时性故障恢复', () => {
  it('502 等网关错误会重试，耗尽后给出明确错误', async () => {
    const calls = stubFetch([502]);
    const http = new PoliteHttpClient({ maxRetries: 1, backoffBaseMs: 0, minIntervalMs: 0 });

    await expect(http.getJson('https://example.com/x')).rejects.toThrow(TransientHttpError);
    expect(calls.count).toBe(2);
  });

  it('表单 POST 与 GET 使用同一套暂时性错误策略', async () => {
    const calls = stubFetch([503, 200], { access_token: 'ok' });
    const http = new PoliteHttpClient({ maxRetries: 1, backoffBaseMs: 0, minIntervalMs: 0 });

    await expect(http.postForm('https://example.com/token', { grant_type: 'x' })).resolves.toEqual({
      access_token: 'ok',
    });
    expect(calls.count).toBe(2);
  });

  it('网络异常会重试，恢复后返回结果', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('socket reset');
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const http = new PoliteHttpClient({ maxRetries: 1, backoffBaseMs: 0, minIntervalMs: 0 });

    await expect(http.getJson('https://example.com/x')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('解析 Retry-After 秒数与 HTTP 日期', () => {
    expect(retryAfterMs('1.5', 0)).toBe(1500);
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:02 GMT', 1000)).toBe(1000);
    expect(retryAfterMs('bad', 0)).toBeUndefined();
  });
});

describe('错误信息脱敏与配置校验', () => {
  it('URL 中的 key/token/secret 不进入日志', async () => {
    stubFetch([403]);
    const http = new PoliteHttpClient({ maxRetries: 0, minIntervalMs: 0 });
    const secret = 'super-secret-value';

    await expect(
      http.getJson(`https://example.com/x?key=${secret}&query=phone`),
    ).rejects.not.toThrow(secret);
    expect(redactUrl(`https://example.com/x?access_token=${secret}&query=phone`)).toContain(
      'query=phone',
    );
    expect(redactUrl(`https://example.com/x?access_token=${secret}`)).not.toContain(secret);
  });

  it('构造时拒绝无效限流和超时参数', () => {
    expect(() => new PoliteHttpClient({ maxRetries: -1 })).toThrow(RangeError);
    expect(() => new PoliteHttpClient({ timeoutMs: 0 })).toThrow(RangeError);
  });
});
