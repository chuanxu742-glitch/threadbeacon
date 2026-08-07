// TikHub provider 的共用骨架。
//
// 各平台的差异只有三处：端点路径、请求参数名、响应字段映射。
// 分页循环、评论抓取、bundle 打包全部收在这里，子类只填那三处。
//
// 上游 SeekMoney-ai 是每个平台一份 300-400 行的 service，彼此大段重复；
// 拆成「骨架 + 映射」后每个平台约 80 行，加平台的成本主要落在读懂响应结构上。

import { BaseProvider } from '../base.js';
import type {
  AcquisitionMode,
  ProviderCapability,
  RawObservation,
  SearchQuery,
  TextBundle,
} from '../types.js';
import type { TikHubClient } from './client.js';

export interface TikHubProviderDeps {
  readonly http: import('../http.js').HttpPort;
  readonly client: TikHubClient;
  /** 每个帖子最多取多少条评论，默认 20。评论按次计费，调大直接乘成本。 */
  readonly maxCommentsPerPost?: number;
}

/** 子类描述「怎么搜」与「怎么解析」。 */
export interface TikHubEndpointSpec {
  /** 搜索端点路径。 */
  readonly searchPath: string;
  /** 单页条数上限，取端点允许的最大值以减少请求次数。 */
  readonly pageSize: number;
  /** 构造搜索参数。page 从 1 开始。 */
  buildSearchParams(keyword: string, page: number, want: number): Record<string, string | number>;
  /** 从响应里解析出记录。返回空数组表示该页没有更多。 */
  parseSearch(data: unknown): RawObservation[];

  /** 评论端点。不支持评论的平台留空。 */
  readonly commentPath?: string;
  buildCommentParams?(postId: string, want: number): Record<string, string | number>;
  parseComments?(data: unknown, postId: string): RawObservation[];
}

export abstract class TikHubProvider extends BaseProvider {
  abstract readonly capability: ProviderCapability;
  protected abstract readonly spec: TikHubEndpointSpec;

  protected readonly client: TikHubClient;
  protected readonly maxCommentsPerPost: number;

  constructor(deps: TikHubProviderDeps) {
    super({ http: deps.http });
    this.client = deps.client;
    this.maxCommentsPerPost = deps.maxCommentsPerPost ?? 20;
  }

  async searchAll(query: SearchQuery): Promise<TextBundle> {
    const posts = await this.collectPosts(query);
    const out: RawObservation[] = [...posts];

    if (query.includeComments && this.spec.commentPath) {
      for (const p of posts) {
        if (!p.id) continue;
        out.push(...(await this.fetchComments(p.id)));
      }
    }
    return this.bundle(out, 'searchAll' as AcquisitionMode);
  }

  /** 翻页直到攒够 limit 或某页返回空。 */
  private async collectPosts(query: SearchQuery): Promise<RawObservation[]> {
    const acc: RawObservation[] = [];
    let page = 1;

    while (acc.length < query.limit) {
      const want = Math.min(this.spec.pageSize, query.limit - acc.length);
      const data = await this.client.get<unknown>(
        this.spec.searchPath,
        this.spec.buildSearchParams(query.keyword, page, want),
      );

      const items = this.spec.parseSearch(data);
      if (items.length === 0) break;

      acc.push(...items);
      // 返回不足一页说明没有更多了，再翻只是白烧一次计费
      if (items.length < want) break;
      page += 1;
    }
    return acc.slice(0, query.limit);
  }

  /**
   * 单个帖子的评论。
   *
   * 失败不致命 —— 关闭评论、已删除、限流都会让单条失败，
   * 整批中断的代价远高于少一条评论。
   */
  private async fetchComments(postId: string): Promise<RawObservation[]> {
    const { commentPath, buildCommentParams, parseComments } = this.spec;
    if (!commentPath || !buildCommentParams || !parseComments) return [];

    try {
      const data = await this.client.get<unknown>(
        commentPath,
        buildCommentParams(postId, this.maxCommentsPerPost),
      );
      return parseComments(data, postId);
    } catch {
      return [];
    }
  }
}

/** 各 TikHub provider 共用的配额说明。 */
export const TIKHUB_QUOTA = {
  unit: 'requests',
  note: '按次计费，随端点浮动（量级 $0.001-0.01/次）；搜索翻页与逐帖抓评论都会成倍放大调用数',
} as const;

/**
 * 生成 legalBasis。
 *
 * 强制带上 unofficial 定性 —— 这句话会原样进每条数据的 provenance，
 * 是审计时第一个被看的字段，不能写成「官方授权」。
 */
export function vendorLegalBasis(platform: string): string {
  return (
    `第三方数据供应商 TikHub 转售的 ${platform} 公开内容。` +
    `TikHub 服务条款自述 "TikHub is an unofficial API"，非平台官方授权通道；` +
    `合规责任由部署者承担，商用前应自行评估并留存与供应商的合同`
  );
}
