import { describe, expect, it } from 'vitest';
import { BlueskyJetstreamProvider } from '../src/providers/bluesky-jetstream.js';
import type { HttpPort } from '../src/providers/http.js';

/** 不做网络的假 HttpPort —— Jetstream 走 WebSocket，这里只为满足基类依赖。 */
const noHttp: HttpPort = {
  authMode: 'anonymous',
  async getJson<T>(): Promise<T> {
    throw new Error('不应被调用');
  },
  async postForm<T>(): Promise<T> {
    throw new Error('不应被调用');
  },
};

/** 可脚本化的假 WebSocket：构造后按需推送消息。 */
class FakeSocket {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }

  push(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent);
  }

  pushRaw(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const post = (text: string, createdAt = '2026-08-05T10:00:00Z', langs?: string[]) => ({
  kind: 'commit',
  commit: {
    operation: 'create',
    collection: 'app.bsky.feed.post',
    record: { text, createdAt, ...(langs ? { langs } : {}) },
  },
});

/** 构造 provider 并在下一个微任务把脚本喂进假 socket。 */
function withSocket(script: (s: FakeSocket) => void) {
  const socket = new FakeSocket();
  const p = new BlueskyJetstreamProvider({
    http: noHttp,
    webSocketFactory: () => socket as unknown as WebSocket,
  });
  queueMicrotask(() => script(socket));
  return { p, socket };
}

describe('BlueskyJetstreamProvider', () => {
  it('过滤出含关键词的帖子并在攒够后收口', async () => {
    const { p, socket } = withSocket((s) => {
      s.push(post('my battery life is terrible'));
      s.push(post('unrelated cat photo'));
      s.push(post('BATTERY LIFE is great actually'));
    });

    const bundle = await p.streamLive({ keyword: 'battery life', limit: 2, maxDurationMs: 2000 });

    expect(bundle.items).toHaveLength(2);
    expect(bundle.items[0]!.text).toContain('battery life');
    // 关键词匹配大小写不敏感
    expect(bundle.items[1]!.text).toContain('BATTERY LIFE');
    expect(socket.closed).toBe(true);
  });

  it('声明 streamLive 模式与 open-protocol / anonymous', async () => {
    const { p, socket } = withSocket((s) => s.onclose?.());
    expect(p.capability.modes).toEqual(['streamLive']);

    const bundle = await p.streamLive({ keyword: 'x', limit: 1, maxDurationMs: 50 });
    expect(bundle.provenance.mode).toBe('streamLive');
    expect(bundle.provenance.kind).toBe('open-protocol');
    expect(bundle.provenance.auth).toBe('anonymous');
    expect(socket.closed).toBe(true);
  });

  it('丢弃标识符，只留文本与日期桶', async () => {
    const { p } = withSocket((s) => {
      s.push({
        kind: 'commit',
        did: 'did:plc:abc123',
        commit: {
          operation: 'create',
          collection: 'app.bsky.feed.post',
          rkey: 'xyz',
          record: { text: 'battery drains fast', createdAt: '2026-08-05T13:47:22Z', langs: ['en'] },
        },
      });
    });

    const bundle = await p.streamLive({ keyword: 'battery', limit: 1, maxDurationMs: 2000 });
    expect(bundle.items[0]!.timeBucket).toBe('2026-08-05');
    expect(bundle.items[0]!.lang).toBe('en');
    expect(JSON.stringify(bundle)).not.toContain('did:plc:abc123');
  });

  it('忽略非 create 操作与其他集合', async () => {
    const { p } = withSocket((s) => {
      s.push({
        kind: 'commit',
        commit: { operation: 'delete', collection: 'app.bsky.feed.post', record: { text: 'battery', createdAt: '2026-08-05T00:00:00Z' } },
      });
      s.push({
        kind: 'commit',
        commit: { operation: 'create', collection: 'app.bsky.feed.like', record: { text: 'battery', createdAt: '2026-08-05T00:00:00Z' } },
      });
      s.onclose?.();
    });

    const bundle = await p.streamLive({ keyword: 'battery', limit: 5, maxDurationMs: 2000 });
    expect(bundle.items).toHaveLength(0);
  });

  it('单条坏 JSON 不中断整条流', async () => {
    const { p } = withSocket((s) => {
      s.pushRaw('{ 这不是合法 JSON');
      s.push(post('battery is fine'));
    });

    const bundle = await p.streamLive({ keyword: 'battery', limit: 1, maxDurationMs: 2000 });
    expect(bundle.items).toHaveLength(1);
  });

  it('到达时限后即使没攒够也返回', async () => {
    const { p, socket } = withSocket((s) => s.push(post('battery ok')));

    const t0 = Date.now();
    const bundle = await p.streamLive({ keyword: 'battery', limit: 99, maxDurationMs: 120 });

    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(bundle.items).toHaveLength(1);
    expect(socket.closed).toBe(true);
  });

  it('连接出错时返回已收集的部分而不是抛错', async () => {
    const { p } = withSocket((s) => {
      s.push(post('battery half'));
      s.onerror?.();
    });

    const bundle = await p.streamLive({ keyword: 'battery', limit: 10, maxDurationMs: 5000 });
    expect(bundle.items).toHaveLength(1);
  });
});
