// 确定性的假 embedding provider。
//
// 让聚类层可以在零 API key、零网络的条件下测试 —— 这也顺带证明了
// clustering/ 与任何数据供应商都不耦合。

import type { IEmbeddingProvider, ProviderStats } from '../../src/clustering/EmbeddingProvider.js';

const DIM = 8;

/** 命中同一探针词的文本得到同一向量（余弦距离 0），不同探针词彼此正交（距离 1）。 */
export class FakeEmbeddingProvider implements IEmbeddingProvider {
  private requests = 0;

  constructor(private readonly probes: readonly string[]) {
    if (probes.length >= DIM) {
      throw new RangeError(`探针词数量须小于向量维度 ${DIM}`);
    }
  }

  getName(): string {
    return 'fake';
  }

  getModel(): string {
    return 'fake-deterministic';
  }

  getDimension(): number {
    return DIM;
  }

  getCostPerMillionTokens(): number {
    return 0;
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    this.requests += 1;
    return texts.map((t) => {
      const v = new Array<number>(DIM).fill(0);
      const idx = this.probes.findIndex((p) => t.includes(p));
      v[idx >= 0 ? idx : DIM - 1] = 1;
      return v;
    });
  }

  async checkAvailability(): Promise<boolean> {
    return true;
  }

  getStats(): ProviderStats {
    return {
      provider: 'fake',
      model: 'fake-deterministic',
      requestCount: this.requests,
      tokenCount: 0,
      successCount: this.requests,
      failureCount: 0,
      totalDuration: 0,
      averageDuration: 0,
      estimatedCost: 0,
    };
  }
}
