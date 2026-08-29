// 小红书 provider —— 经 Spider_XHS 取数。
//
// Spider_XHS (https://github.com/cv-cat/Spider_XHS) 无 LICENSE 文件，按全版权
// 保留处理：其代码不进本仓库，由使用者自行 clone，本 provider 通过子进程调用
// scripts/spider_xhs_bridge.py（threadbeacon 原创）与之通信。
// 该项目 README 声明「仅供学习交流使用，禁止任何商业化行为」。
//
// 凭据：需要用自有账号扫码登录一次，cookie 落盘复用。因此 authMode 是
// 'user-session' —— threadbeacon 自己一个 Cookie 都不发，但 provenance 必须如实
// 记录这批数据来自登录态，否则审计时无法与官方 API 的数据区分。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BaseProvider } from '../base.js';
import type {
  ProviderCapability,
  RawObservation,
  SearchQuery,
  TextBundle,
} from '../types.js';

const run = promisify(execFile);

/** 桥接脚本的统一返回。 */
interface BridgeResult<T = unknown> {
  readonly ok: boolean;
  readonly message: string;
  readonly data: T | null;
}

export class SpiderXhsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpiderXhsError';
  }
}

/**
 * 子进程执行器。抽出来是为了能离线测试解析逻辑 ——
 * 与各 provider 注入 HttpPort 是同一个用意：不为跑测试而真的起进程。
 */
export type BridgeRunner = (args: readonly string[]) => Promise<string>;

export interface SpiderXhsOptions {
  /** 本地 Spider_XHS 仓库的绝对路径。 */
  readonly spiderPath: string;
  /** 登录 cookie 的存放位置。 */
  readonly cookieFile: string;
  /** python 可执行文件，默认 'python'。 */
  readonly pythonBin?: string;
  /** 桥接脚本路径，默认取仓库内的 scripts/spider_xhs_bridge.py。 */
  readonly bridgeScript?: string;
  /** 每篇笔记最多取多少条评论，默认 50。 */
  readonly maxCommentsPerNote?: number;
  /** 单次子进程调用的超时（毫秒），默认 180 秒。搜索翻页可能很慢。 */
  readonly timeoutMs?: number;
  /** 覆盖子进程执行方式，仅测试用。 */
  readonly runner?: BridgeRunner;
}

const DEFAULT_BRIDGE = 'scripts/spider_xhs_bridge.py';

/** 小红书笔记链接。接口只给 id，链接得自己拼。 */
function noteUrl(id: string, xsecToken?: string): string {
  const base = `https://www.xiaohongshu.com/explore/${id}`;
  // xsec_token 是访问详情/评论的必需参数，取评论时要原样带回去
  return xsecToken ? `${base}?xsec_token=${xsecToken}&xsec_source=pc_search` : base;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  // 小红书的计数字段常是字符串，且可能是 "1.2万" 这种，无法解析时返回 undefined
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 秒级或毫秒级时间戳都可能出现，按量级判断。 */
function toIso(v: unknown): string | undefined {
  const n = num(v);
  if (n === undefined || n <= 0) return undefined;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export class SpiderXhsProvider extends BaseProvider {
  readonly capability: ProviderCapability = {
    id: 'xiaohongshu-spider-xhs',
    platform: 'xiaohongshu',
    // 用的是运行者自有账号的登录态，不是平台签发给应用的凭据
    kind: 'user-authorized',
    modes: ['searchAll'],
    canFetchComments: true,
    legalBasis:
      '经 Spider_XHS（第三方开源工具，无 LICENSE，README 声明禁止商业化）以运行者' +
      '自有账号登录态采集小红书公开笔记。非平台官方授权通道；' +
      '账号归属为运行者本人，但仍属登录态采集，合规责任由部署者承担',
    // 调的是小红书 Web API，不是爬网页；但也不是官方开放平台端点
    robots: 'unchecked',
  };

  private readonly opts: {
    spiderPath: string;
    cookieFile: string;
    pythonBin: string;
    bridgeScript: string;
    maxCommentsPerNote: number;
    timeoutMs: number;
  };
  private readonly runner: BridgeRunner;

  constructor(opts: SpiderXhsOptions) {
    super({ authMode: 'user-session' });
    this.opts = {
      spiderPath: opts.spiderPath,
      cookieFile: opts.cookieFile,
      pythonBin: opts.pythonBin ?? 'python',
      bridgeScript: opts.bridgeScript ?? DEFAULT_BRIDGE,
      maxCommentsPerNote: opts.maxCommentsPerNote ?? 50,
      timeoutMs: opts.timeoutMs ?? 180_000,
    };
    this.runner = opts.runner ?? ((args) => this.spawn(args));
  }

  /** 真正起子进程。业务失败时脚本以退出码 1 结束但 stdout 仍有 JSON，要保留下来。 */
  private async spawn(args: readonly string[]): Promise<string> {
    try {
      const res = await run(this.opts.pythonBin, [this.opts.bridgeScript, ...args], {
        env: { ...process.env, SPIDER_XHS_PATH: this.opts.spiderPath },
        timeout: this.opts.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
      });
      return res.stdout;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      if (err.stdout?.trim()) return err.stdout;
      throw new SpiderXhsError(
        `调用桥接脚本失败（${this.opts.pythonBin} ${this.opts.bridgeScript}）：` +
          `${err.message ?? 'unknown'}\n${err.stderr ?? ''}`,
      );
    }
  }

  /** 调一次桥接脚本。stdout 最后一行是 JSON，前面可能有第三方库的输出。 */
  private async bridge<T>(args: readonly string[]): Promise<BridgeResult<T>> {
    const stdout = await this.runner(args);

    const lines = stdout.trim().split('\n');
    const last = lines[lines.length - 1];
    if (!last) throw new SpiderXhsError('桥接脚本没有输出');
    try {
      return JSON.parse(last) as BridgeResult<T>;
    } catch {
      throw new SpiderXhsError(`桥接脚本输出不是 JSON：${last.slice(0, 300)}`);
    }
  }

  override async checkAvailability(): Promise<boolean> {
    try {
      const res = await this.bridge(['search', '--cookie-file', this.opts.cookieFile,
        '--keyword', 'test', '--limit', '1']);
      return res.ok;
    } catch {
      return false;
    }
  }

  async searchAll(query: SearchQuery): Promise<TextBundle> {
    const res = await this.bridge<unknown[]>([
      'search',
      '--cookie-file', this.opts.cookieFile,
      '--keyword', query.keyword,
      '--limit', String(query.limit),
    ]);
    if (!res.ok) throw new SpiderXhsError(res.message);

    const raws: RawObservation[] = [];
    const forComments: Array<{ id: string; url: string }> = [];

    for (const item of res.data ?? []) {
      const parsed = this.parseNote(item);
      if (!parsed) continue;
      raws.push(parsed.obs);
      forComments.push({ id: parsed.id, url: parsed.url });
    }

    if (query.includeComments) {
      for (const note of forComments) {
        raws.push(...(await this.fetchComments(note.url, note.id)));
      }
    }
    return this.bundle(raws, 'searchAll');
  }

  /**
   * 解析一条搜索结果。
   *
   * Spider_XHS 的返回是小红书 Web API 的原始结构，笔记体在 note_card 下；
   * 不同端点包装层不一致，这里对几种常见形态都兜一下。
   */
  private parseNote(item: unknown): { obs: RawObservation; id: string; url: string } | undefined {
    if (typeof item !== 'object' || item === null) return undefined;
    const o = item as Record<string, unknown>;

    const card = (o['note_card'] ?? o['note'] ?? o) as Record<string, unknown>;
    const id = str(o['id']) ?? str(card['note_id']) ?? str(card['id']);
    if (!id) return undefined;

    const title = str(card['display_title']) ?? str(card['title']);
    const desc = str(card['desc']);
    const text = [title, desc].filter(Boolean).join('\n\n');
    if (!text) return undefined;

    const user = (card['user'] ?? {}) as Record<string, unknown>;
    const inter = (card['interact_info'] ?? {}) as Record<string, unknown>;
    const xsecToken = str(o['xsec_token']) ?? str(card['xsec_token']);
    const url = noteUrl(id, xsecToken);

    const postedAt =
      toIso(card['time']) ?? toIso(card['last_update_time']) ?? new Date().toISOString();

    return {
      id,
      url,
      obs: {
        text,
        observedAt: postedAt,
        platform: 'xiaohongshu',
        itemType: 'post',
        id,
        url,
        ...(title ? { title } : {}),
        ...(str(user['nickname']) ? { author: str(user['nickname'])! } : {}),
        ...(str(user['user_id']) ? { authorId: str(user['user_id'])! } : {}),
        metrics: {
          likes: num(inter['liked_count']) ?? 0,
          comments: num(inter['comment_count']) ?? 0,
          shares: num(inter['share_count']) ?? 0,
        },
        raw: {
          xsecToken,
          collectedCount: num(inter['collected_count']),
          noteType: card['type'],
          // time 缺失时上面回退成采集时刻，标出来以免下游当成发布时间
          timeMissing: toIso(card['time']) === undefined,
        },
      },
    };
  }

  /** 单篇笔记的评论。失败不致命：关评论、已删、限流都会走到这里。 */
  private async fetchComments(url: string, noteId: string): Promise<RawObservation[]> {
    let res: BridgeResult<unknown[]>;
    try {
      res = await this.bridge<unknown[]>([
        'comments',
        '--cookie-file', this.opts.cookieFile,
        '--url', url,
      ]);
    } catch {
      return [];
    }
    if (!res.ok || !res.data) return [];

    const out: RawObservation[] = [];
    for (const raw of res.data.slice(0, this.opts.maxCommentsPerNote)) {
      if (typeof raw !== 'object' || raw === null) continue;
      const c = raw as Record<string, unknown>;
      const text = str(c['content']);
      if (!text) continue;

      const user = (c['user_info'] ?? c['user'] ?? {}) as Record<string, unknown>;
      out.push({
        text,
        observedAt: toIso(c['create_time']) ?? new Date().toISOString(),
        platform: 'xiaohongshu',
        itemType: 'comment',
        parentId: noteId,
        ...(str(c['id']) ? { id: str(c['id'])! } : {}),
        ...(str(user['nickname']) ? { author: str(user['nickname'])! } : {}),
        ...(str(user['user_id']) ? { authorId: str(user['user_id'])! } : {}),
        metrics: {
          likes: num(c['like_count']) ?? 0,
          comments: num(c['sub_comment_count']) ?? 0,
        },
        raw: { ipLocation: c['ip_location'] },
      });
    }
    return out;
  }
}
