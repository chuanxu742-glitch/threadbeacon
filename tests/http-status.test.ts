import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ForbiddenError,
  PoliteHttpClient,
  RateLimitedError,
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
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 1 });

    await expect(http.getJson('https://example.com/x')).rejects.toThrow(ForbiddenError);
    // 关键：只发一次。403 是「被拒绝」，重试同一个请求不会变成 200
    expect(calls.count).toBe(1);
  });

  it('403 不会被误报成限流，且错误信息指向排查方向', async () => {
    stubFetch([403]);
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 1 });

    // 语义断言：403 永远不该是 RateLimitedError —— 早期版本正是这样误诊的
    await expect(http.getJson('https://example.com/x')).rejects.not.toThrow(RateLimitedError);
    await expect(http.getJson('https://example.com/x')).rejects.toThrow(/需要授权|凭据/);
  });

  it('429 才走退避重试，超出次数后报 RateLimitedError', async () => {
    const calls = stubFetch([429]);
    const http = new PoliteHttpClient({ maxRetries: 2, backoffBaseMs: 1 });

    await expect(http.getJson('https://example.com/x')).rejects.toThrow(RateLimitedError);
    expect(calls.count).toBe(3); // 首次 + 2 次重试
  });

  it('429 后恢复则正常返回', async () => {
    stubFetch([429, 200], { hello: 'world' });
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 1 });

    await expect(http.getJson<{ hello: string }>('https://example.com/x')).resolves.toEqual({
      hello: 'world',
    });
  });

  it('503 视同过载，走重试', async () => {
    const calls = stubFetch([503, 200], { ok: 1 });
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 1 });

    await http.getJson('https://example.com/x');
    expect(calls.count).toBe(2);
  });

  it('其他 4xx 直接报错且不重试', async () => {
    const calls = stubFetch([404]);
    const http = new PoliteHttpClient({ maxRetries: 3, backoffBaseMs: 1 });

    await expect(http.getJson('https://example.com/x')).rejects.toThrow(/HTTP 404/);
    expect(calls.count).toBe(1);
  });
});
