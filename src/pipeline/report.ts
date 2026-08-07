// 分析产物的类型。
//
// AnalysisReport 同时承载两样东西：LLM 归纳出的聚类级洞察（painPoints），
// 以及采集到的全部原始记录（items）。导出层从这一个对象派生 JSON 与 CSV。

import type { Provenance, SourceItem } from '../providers/types.js';

export interface PainPoint {
  /** LLM 归纳的主题短语。 */
  readonly theme: string;
  /** 代表性表述，由 LLM 概括。 */
  readonly summary: string;
  /** 簇规模。 */
  readonly size: number;
  readonly keywords: readonly string[];
  /** 严重度 0-5，由 LLM 评估。 */
  readonly severity: number;
  /** 簇内原文，按位对应 memberIndices。 */
  readonly texts: readonly string[];
  /** 簇成员在 items 数组里的下标，用于把痛点关联回原始记录。 */
  readonly memberIndices: readonly number[];
}

/**
 * 数据可靠性分级。样本量太小的结论不该被当成市场信号，
 * 在产物里显式标出来，避免下游误读。
 */
export type DataQuality = 'exploratory' | 'preliminary' | 'reliable';

export function gradeQuality(clusteredTexts: number): DataQuality {
  if (clusteredTexts >= 200) return 'reliable';
  if (clusteredTexts >= 50) return 'preliminary';
  return 'exploratory';
}

export interface AnalysisStats {
  readonly totalTexts: number;
  readonly clusteredTexts: number;
  readonly clusterCount: number;
  readonly noiseCount: number;
}

export interface AnalysisReport {
  readonly painPoints: readonly PainPoint[];
  /** 本次采集到的全部记录，顺序与 PainPoint.memberIndices 对应。 */
  readonly items: readonly SourceItem[];
  readonly provenance: Provenance;
  readonly stats: AnalysisStats;
  readonly dataQuality: DataQuality;
  readonly keyword: string;
  readonly generatedAt: string;
}
