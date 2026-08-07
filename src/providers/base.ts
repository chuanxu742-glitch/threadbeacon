// Provider 基类：统一 provenance 构造与打包入口。
//
// 子类只负责「怎么把平台响应变成 RawObservation」，
// 打包一律走 bundle()，provenance 由基类填，不让子类自报。

import { buildSourceItems } from './item.js';
import type { HttpPort } from './http.js';
import type {
  AcquisitionMode,
  IDataProvider,
  Provenance,
  ProviderCapability,
  RawObservation,
  TextBundle,
} from './types.js';

export interface BaseProviderDeps {
  readonly http: HttpPort;
}

export abstract class BaseProvider implements IDataProvider {
  abstract readonly capability: ProviderCapability;

  protected readonly http: HttpPort;

  constructor(deps: BaseProviderDeps) {
    this.http = deps.http;
  }

  /**
   * 把原始观测打包成 TextBundle。
   *
   * 这是子类唯一被允许的出口 —— provenance 的 auth 字段直接取自 http 客户端的
   * 实际档位，而不是子类自报，避免声明与行为不一致。
   */
  protected async bundle(
    raws: readonly RawObservation[],
    mode: AcquisitionMode,
  ): Promise<TextBundle> {
    const items = buildSourceItems(raws);
    const provenance: Provenance = {
      providerId: this.capability.id,
      platform: this.capability.platform,
      kind: this.capability.kind,
      mode,
      fetchedAt: new Date().toISOString(),
      legalBasis: this.capability.legalBasis,
      // 取自 capability 而非写死 —— 之前这里硬编码 true，等于在审计记录里
      // 声明了一件从未发生的事（代码库里根本没有 robots 检查逻辑）
      robots: this.capability.robots,
      auth: this.http.authMode,
    };
    return { items, provenance };
  }

  async checkAvailability(): Promise<boolean> {
    return true;
  }
}

/** 分页取数的通用循环：反复调 fetchPage 直到攒够 limit 或没有下一页。 */
export async function paginate<T>(
  limit: number,
  pageSize: number,
  fetchPage: (cursor: string | undefined, want: number) => Promise<{ items: T[]; cursor?: string }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;

  while (out.length < limit) {
    const want = Math.min(pageSize, limit - out.length);
    const page = await fetchPage(cursor, want);
    if (page.items.length === 0) break;
    out.push(...page.items);
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return out.slice(0, limit);
}
