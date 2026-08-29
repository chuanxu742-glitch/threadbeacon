// Bluesky Jetstream provider —— AT Protocol 实时事件流。
//
// 为什么是这个而不是 searchPosts：
// 2026-08-05 实测，同一代理下 app.bsky.actor.getProfile 返回 200，
// 而 app.bsky.feed.searchPosts 返回 403 —— 历史检索需要会话凭据，
// 而 Bluesky 的会话凭据是 app password，属用户凭据，本项目不支持。
// Jetstream 则**无需任何授权**，实测连上即收到事件。
//
// 代价是获取形态变了：只能拿订阅期间的增量，拿不到历史。
// 想覆盖某个话题就得持续订阅，而不是发一次查询。

import { BaseProvider, type BaseProviderDeps } from './base.js';
import type { ProviderCapability, RawObservation, StreamQuery, TextBundle } from './types.js';

const DEFAULT_ENDPOINT = 'wss://jetstream2.us-east.bsky.network/subscribe';
const POST_COLLECTION = 'app.bsky.feed.post';

/** Jetstream 的 commit 事件，只声明本 provider 读取的字段。 */
interface JetstreamEvent {
  readonly did?: string;
  readonly time_us?: number;
  readonly kind?: string;
  readonly commit?: {
    readonly rev?: string;
    readonly operation?: string;
    readonly collection?: string;
    readonly rkey?: string;
    readonly cid?: string;
    readonly record?: {
      readonly text?: string;
      readonly createdAt?: string;
      readonly langs?: readonly string[];
      readonly reply?: {
        readonly root?: { readonly uri?: string };
        readonly parent?: { readonly uri?: string };
      };
      readonly embed?: unknown;
      readonly facets?: unknown;
    };
  };
}

/** 便于测试注入的 WebSocket 工厂。 */
export type WebSocketFactory = (url: string) => WebSocket;

export interface JetstreamProviderOptions extends BaseProviderDeps {
  readonly endpoint?: string;
  readonly profileEndpoint?: string;
  readonly webSocketFactory?: WebSocketFactory;
}

export class BlueskyJetstreamProvider extends BaseProvider {
  readonly capability: ProviderCapability = {
    id: 'bluesky-jetstream',
    platform: 'bluesky',
    kind: 'open-protocol',
    modes: ['streamLive'],
    canFetchComments: false,
    legalBasis: 'AT Protocol Jetstream 公开事件流，协议设计上即面向公开订阅，无需授权',
    robots: 'not-applicable',
  };

  private readonly endpoint: string;
  private readonly profileEndpoint: string;
  private readonly makeSocket: WebSocketFactory;
  private readonly handles = new Map<string, Promise<string | undefined>>();

  constructor(opts: JetstreamProviderOptions) {
    super(opts);
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.profileEndpoint = opts.profileEndpoint ?? 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile';
    this.makeSocket = opts.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  async streamLive(query: StreamQuery): Promise<TextBundle> {
    const url = `${this.endpoint}?wantedCollections=${POST_COLLECTION}`;
    const needle = query.keyword.toLowerCase();
    const collected: RawObservation[] = [];

    const ws = this.makeSocket(url);

    await new Promise<void>((resolve) => {
      // 无论因何结束都只收口一次，避免 close 与 timeout 竞争重复 resolve
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // 已经关掉了，忽略
        }
        resolve();
      };

      const timer = setTimeout(finish, query.maxDurationMs);

      ws.onmessage = (ev: MessageEvent): void => { void (async () => {
        const raw = typeof ev.data === 'string' ? ev.data : undefined;
        if (raw === undefined) return;

        let parsed: JetstreamEvent;
        try {
          parsed = JSON.parse(raw) as JetstreamEvent;
        } catch {
          return; // 单条坏消息不该中断整条流
        }

        const commit = parsed.commit;
        if (commit?.operation !== 'create' || commit.collection !== POST_COLLECTION) return;

        const record = commit.record;
        const text = record?.text;
        const createdAt = record?.createdAt;
        if (!text || !createdAt) return;
        if (!text.toLowerCase().includes(needle)) return;

        // AT Protocol 的记录地址：at://{did}/{collection}/{rkey}，
        // 对应的网页链接是 bsky.app/profile/{did}/post/{rkey}
        const did = parsed.did;
        const rkey = commit.rkey;
        const handle = did ? await this.resolveHandle(did) : undefined;
        const atUri = did && rkey ? `at://${did}/${POST_COLLECTION}/${rkey}` : undefined;
        // 回复的 parent 是 at:// uri，直接作为 parentId 关联回被回复的帖子
        const parent = record?.reply?.parent?.uri;

        collected.push({
          text,
          observedAt: createdAt,
          platform: 'bluesky',
          itemType: record?.reply ? 'comment' : 'post',
          ...(rkey ? { id: rkey } : {}),
          ...(parent ? { parentId: parent } : {}),
          ...(did ? { authorId: did } : {}),
          ...(handle ? { author: handle } : {}),
          ...(did && rkey ? { url: `https://bsky.app/profile/${handle ?? did}/post/${rkey}` } : {}),
          ...(record?.langs?.[0] !== undefined ? { lang: record.langs[0] } : {}),
          raw: {
            atUri,
            cid: commit.cid,
            rev: commit.rev,
            timeUs: parsed.time_us,
            replyRoot: record?.reply?.root?.uri,
            embed: record?.embed,
            facets: record?.facets,
          },
        });
        if (collected.length >= query.limit) finish();
      })(); };

      ws.onerror = finish;
      ws.onclose = finish;
    });

    return this.bundle(collected, 'streamLive');
  }

  private resolveHandle(did: string): Promise<string | undefined> {
    const cached = this.handles.get(did);
    if (cached) return cached;
    const lookup = (async () => {
      try {
        const url = new URL(this.profileEndpoint);
        url.searchParams.set('actor', did);
        const profile = await this.http.getJson<{ readonly handle?: string }>(url.toString());
        return profile.handle?.trim() || undefined;
      } catch {
        return undefined;
      }
    })();
    this.handles.set(did, lookup);
    return lookup;
  }
}
