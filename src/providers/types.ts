// 数据接入层的类型契约。
//
// 把「平台」与「供应商」拆成两个维度，取数模式显式化，
// 让各 provider 的能力差异在类型层面可见而不是靠文档约定。

import type { AuthMode } from './http.js';

export type { AuthMode };

/** 原生实现的平台。 */
export type NativePlatform =
  | 'bluesky'
  | 'reddit'
  | 'youtube'
  | 'twitter'
  | 'tiktok'
  | 'instagram'
  | 'douyin'
  | 'xiaohongshu'
  | 'weibo'
  | 'kuaishou';

/**
 * 由 OpenCLI 动态发现的站点。使用前缀避免和原生 provider 的平台名冲突，
 * 例如 `opencli:bilibili`、`opencli:zhihu`、`opencli:eastmoney`。
 *
 * 这条路径通过外部 OpenCLI 进程复用运行者自己的浏览器会话；它不把任何签名逆向、
 * Cookie 或站点私有实现复制进 threadbeacon。登录态和站点条款风险仍会如实写入 provenance。
 */
export type OpenCliPlatform = `opencli:${string}`;

/** 用户在控制台登记的通用只读数据源。 */
export type GenericPlatform = 'rss' | 'rest' | 'web';

/** 受控 GEO 能力；当前只发布版本化的公开官网观测。 */
export type ManagedPlatform = 'geo';

/** 目标平台。与「供应商」是两个独立维度，不要混进同一个枚举。 */
export type Platform = NativePlatform | OpenCliPlatform | GenericPlatform | ManagedPlatform;

export function openCliPlatform(site: string): OpenCliPlatform {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(site)) {
    throw new RangeError(`非法 OpenCLI site：${site}`);
  }
  return `opencli:${site}`;
}

export function openCliSite(platform: Platform): string | undefined {
  return platform.startsWith('opencli:') ? platform.slice('opencli:'.length) : undefined;
}

/**
 * 数据来源的性质。这决定合规定性，是审计时第一个被问的问题。
 * 见 docs/行业合规范式.md §1。
 */
export type ProviderKind =
  /** 开放协议，无需授权。目前只有 Bluesky AT Protocol。 */
  | 'open-protocol'
  /** 平台官方 API，受配额与计费约束。 */
  | 'official-api'
  /** 持牌第三方数据供应商，凭合同取得。 */
  | 'licensed-vendor'
  /** 终端用户授权的自有账号数据（creator API）。 */
  | 'user-authorized';

/**
 * 获取模式。
 *
 * 上游 SeekMoney-ai 的接口假设任何数据源都能按关键词搜全站，
 * 而合规来源恰恰做不到 —— user-authorized 只能取授权账号自己的内容。
 * 拆成两个模式就是为了让这个差异在类型层面显式化。
 */
export type AcquisitionMode =
  /** 按关键词检索全站历史。多数合规来源做不到这件事。 */
  | 'searchAll'
  /** 取终端用户授权账号的自有内容。creator API 的形态。 */
  | 'fetchOwned'
  /**
   * 订阅实时流并在本地过滤。
   *
   * 与 searchAll 的实质差别：只能拿到订阅期间的增量，拿不到历史。
   * Bluesky 的 Jetstream 属于这一类 —— 其历史检索接口需要用户凭据，
   * 而实时流无需授权（2026-08-05 实测确认）。
   */
  | 'streamLive';

/** robots.txt 的遵守状态。见 Provenance.robots 的说明。 */
export type RobotsStatus =
  /** 调用文档化的 API 端点，robots.txt 不适用（它规范的是网页爬取）。 */
  | 'not-applicable'
  /** 已获取并遵守目标站点的 robots.txt。 */
  | 'checked'
  /** 未检查。抓取网页时出现此值即为合规缺陷，不应进生产。 */
  | 'unchecked';

export interface QuotaSpec {
  /** 配额单位，例如 'requests' | 'quota-units' | 'posts'。 */
  unit: string;
  perDay?: number;
  /** 单次调用成本，单位 USD。用于成本预估与限流决策。 */
  costPerCall?: number;
  /** 自由文本备注，例如 YouTube search.list 的独立配额桶。 */
  note?: string;
}

export interface ProviderCapability {
  /** 稳定标识，进审计日志，例如 'bluesky-firehose'、'reddit-official'。 */
  readonly id: string;
  readonly platform: Platform;
  readonly kind: ProviderKind;
  readonly modes: readonly AcquisitionMode[];
  readonly canFetchComments: boolean;
  /**
   * 该来源的授权依据，人类可读。
   * 例如 'AT Protocol 公开 firehose，无需授权' 或 'Reddit Official Data Partner 合同 #xxx'。
   * 这句话会被原样写进每一条数据的 provenance，是 LIA 与审计的基础材料。
   */
  readonly legalBasis: string;
  /**
   * 该 provider 的 robots.txt 遵守状态，由 provider 如实声明。
   * 会被原样写进每一条数据的 provenance —— 不要声明你没做到的事。
   */
  readonly robots: RobotsStatus;
  readonly quota?: QuotaSpec;
}

/**
 * 每一批数据的来源证明。落盘并保留，作为「未突破技术措施」与合法性基础的证据。
 */
export interface Provenance {
  readonly providerId: string;
  readonly platform: Platform;
  readonly kind: ProviderKind;
  readonly mode: AcquisitionMode;
  /** 采集时间，ISO 8601。注意这是采集时刻，不是原帖发布时刻。 */
  readonly fetchedAt: string;
  readonly legalBasis: string;
  /**
   * robots.txt / ai.txt 的遵守状态。
   *
   * 之所以不是 boolean：布尔值只能表达「查了/没查」，而最常见的情况是
   * **不适用** —— robots.txt 规范的是对网页的爬取，调用平台公开文档化的
   * API 端点不在其射程内。用布尔值就只能在两个都不准确的选项里挑一个，
   * 而这个字段会进审计记录，不能含糊。
   *
   * EDPB Guidelines 03/2026 把 robots.txt 视为合理预期的指示信号，
   * 绕过它基本判死正当利益的平衡测试 —— 所以 'unchecked' 不应出现在生产环境。
   */
  readonly robots: RobotsStatus;
  /**
   * 取数时使用的凭据档位。
   *
   * AuthMode 只有 'anonymous' 与 'app-credential' 两个取值 ——
   * 用户会话凭据在类型层面不可表达，这是本项目的硬边界：
   * Meta v. Voyager Labs（登录态 + 假账号）被判永久禁令，
   * Meta v. Bright Data（登出抓公开数据）胜诉。见 docs/行业合规范式.md §4。
   *
   * 注意 'app-credential' 指平台签发给应用的凭据（官方 API），不是用户身份 ——
   * 官方 API 是最合规的取数路径，与「登录态采集」性质完全不同。
   */
  readonly auth: AuthMode;
}

/** 记录的形态。帖子与评论在导出时分表，需要在类型上区分。 */
export type ItemType = 'post' | 'comment';

/** 互动量。各平台字段名不同，在 provider 里归一到这四项，缺的留空。 */
export interface Metrics {
  readonly likes?: number;
  readonly comments?: number;
  readonly shares?: number;
  readonly views?: number;
}

/**
 * 单条采集记录，保留原始字段。
 *
 * 设计取向是**尽量不丢信息**：文本原样保留，作者、链接、精确时间戳一并留存，
 * 平台特有字段进 `raw`。下游的聚类只吃 `text`，其余字段供导出与二次处理。
 */
export interface SourceItem {
  /** 原文，不做改写。 */
  readonly text: string;
  /** 发布时刻，ISO 8601，保留原始精度。 */
  readonly postedAt: string;
  /** 由 postedAt 派生的日期，YYYY-MM-DD。仅为按日聚合方便，不是脱敏措施。 */
  readonly timeBucket: string;
  readonly platform: Platform;
  readonly itemType: ItemType;
  /** 平台内的记录 ID（帖子 id / 评论 id / 视频 id）。 */
  readonly id?: string;
  /** 评论所属的帖子 ID，用于把评论表关联回帖子表。 */
  readonly parentId?: string;
  /** 作者显示名或 handle，平台返回什么就存什么。 */
  readonly author?: string;
  /** 作者在平台内的稳定 ID，与 author 可能不同（如 Reddit 的 t2_xxx）。 */
  readonly authorId?: string;
  /** 原帖链接。 */
  readonly url?: string;
  /** 标题，帖子/视频有，评论没有。 */
  readonly title?: string;
  readonly metrics?: Metrics;
  readonly region?: string;
  /** BCP 47 语言标签。 */
  readonly lang?: string;
  /** 平台原始响应片段，供 JSON 全量导出与二次处理。 */
  readonly raw?: Record<string, unknown>;
}

/**
 * provider 解析平台响应后的中间形态。
 *
 * 与 SourceItem 的差别只有 `observedAt` 接受 Date 或字符串、
 * `timeBucket` 由 buildSourceItem 派生。其余字段一一对应。
 */
export interface RawObservation {
  readonly text: string;
  readonly observedAt: Date | string;
  readonly platform: Platform;
  readonly itemType?: ItemType;
  readonly id?: string;
  readonly parentId?: string;
  readonly author?: string;
  readonly authorId?: string;
  readonly url?: string;
  readonly title?: string;
  readonly metrics?: Metrics;
  readonly region?: string;
  readonly lang?: string;
  readonly raw?: Record<string, unknown>;
}

/** provider 的统一返回。下游分析层只认这个。 */
export interface TextBundle {
  readonly items: readonly SourceItem[];
  readonly provenance: Provenance;
}

export interface SearchQuery {
  readonly keyword: string;
  readonly limit: number;
  /** 是否一并取评论/回复。provider 不支持时应忽略而非报错。 */
  readonly includeComments?: boolean;
}

export interface StreamQuery {
  /** 在流上做本地过滤的关键词，大小写不敏感。 */
  readonly keyword: string;
  /** 攒够这么多条就停。 */
  readonly limit: number;
  /** 最长订阅时长（毫秒）。到时即停，无论攒了多少。 */
  readonly maxDurationMs: number;
}

/** 用户授权的自有账号引用。不是被采集对象的标识符，是授权关系的句柄。 */
export interface OwnedAccountRef {
  /** 由授权流程签发的不透明令牌句柄，不是平台 user ID。 */
  readonly grantHandle: string;
  readonly limit: number;
}

export interface IDataProvider {
  readonly capability: ProviderCapability;
  /** 仅当 capability.modes 含 'searchAll' 时存在。 */
  searchAll?(query: SearchQuery): Promise<TextBundle>;
  /** 仅当 capability.modes 含 'fetchOwned' 时存在。 */
  fetchOwned?(ref: OwnedAccountRef): Promise<TextBundle>;
  /** 仅当 capability.modes 含 'streamLive' 时存在。 */
  streamLive?(query: StreamQuery): Promise<TextBundle>;
  checkAvailability(): Promise<boolean>;
}

/** 取出进入分析核心的纯文本。聚类层只吃 string[]，这是唯一的下游契约。 */
export function textsOf(bundle: TextBundle): string[] {
  return bundle.items.map((it) => it.text);
}
