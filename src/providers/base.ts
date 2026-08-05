// Provider 基类：统一 provenance 构造与脱敏入口。
//
// 子类只负责「怎么把平台响应变成 RawObservation」，
// 最小化与脱敏一律走 buildSourceItems()，没有旁路。

import { buildSourceItems, type PiiRecognizer, type RawObservation } from '../privacy/minimize.js';
import type { HttpPort } from './http.js';
import type {
  AcquisitionMode,
  IDataProvider,
  Provenance,
  ProviderCapability,
  TextBundle,
} from './types.js';

export interface BaseProviderDeps {
  readonly http: HttpPort;
  /** 可选的 NER 脱敏层。生产环境接 Presidio 本地部署。 */
  readonly recognizer?: PiiRecognizer;
}

export abstract class BaseProvider implements IDataProvider {
  abstract readonly capability: ProviderCapability;

  protected readonly http: HttpPort;
  protected readonly recognizer: PiiRecognizer | undefined;

  constructor(deps: BaseProviderDeps) {
    this.http = deps.http;
    this.recognizer = deps.recognizer;
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
    const items = await buildSourceItems(raws, this.recognizer);
    const provenance: Provenance = {
      providerId: this.capability.id,
      platform: this.capability.platform,
      kind: this.capability.kind,
      mode,
      fetchedAt: new Date().toISOString(),
      legalBasis: this.capability.legalBasis,
      robotsChecked: true,
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
