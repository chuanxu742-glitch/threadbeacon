// 数据接入层的类型契约。
//
// 设计原则：把合规约束编码进类型，而不是写在文档里。
// 依据 docs/GDPR架构边界.md §7 —— data minimization by architecture。

import type { AuthMode } from './http.js';

export type { AuthMode };

/** 目标平台。与「供应商」是两个独立维度，不要混进同一个枚举。 */
export type Platform =
  | 'bluesky'
  | 'reddit'
  | 'youtube'
  | 'twitter'
  | 'tiktok'
  | 'instagram'
  | 'douyin'
  | 'xiaohongshu'
  | 'bilibili'
  | 'kuaishou';

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
export type AcquisitionMode = 'searchAll' | 'fetchOwned';

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
  /** 是否已检查并遵守 robots.txt / ai.txt。EDPB Guidelines 03/2026 视其为合理预期的指示信号。 */
  readonly robotsChecked: boolean;
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

/**
 * 单条数据的最小化记录。
 *
 * 这个类型「缺什么」比「有什么」更重要 —— 以下字段被刻意排除，
 * 使标识符在类型层面就无处存放（docs/GDPR架构边界.md §7.1）：
 *   作者 handle / user ID / 头像 URL / 个人主页链接 / 原帖 permalink /
 *   精确时间戳 / 地理坐标 / 粉丝数等准标识符 / 设备指纹
 */
export interface SourceItem {
  /** 已经过 PII 脱敏的文本。未脱敏文本不得构造成 SourceItem。 */
  readonly text: string;
  /** 时间桶，降采样到日：YYYY-MM-DD。精确时间戳是准标识符，不保留。 */
  readonly timeBucket: string;
  readonly platform: Platform;
  /** 国家级地区，ISO 3166-1 alpha-2。不接受更细粒度。 */
  readonly region?: string;
  /** BCP 47 语言标签。 */
  readonly lang?: string;
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
  checkAvailability(): Promise<boolean>;
}

/** 取出进入分析核心的纯文本。聚类层只吃 string[]，这是唯一的下游契约。 */
export function textsOf(bundle: TextBundle): string[] {
  return bundle.items.map((it) => it.text);
}
