import { describe, expect, it } from 'vitest';
import { ClusteringService, K_ANONYMITY_FLOOR } from '../src/clustering/ClusteringService.js';
import { FakeEmbeddingProvider } from './helpers/fakeEmbedding.js';

const PROBES = ['续航', '价格', '客服'] as const;

/** 三个主题各 4 条。真实场景下簇规模须 ≥ K_ANONYMITY_FLOOR，此处是合成语料。 */
const TEXTS = [
  '这个手机续航太差了，一天要充两次电',
  '续航能力完全不行，出门必须带充电宝',
  '用了三个月，续航明显下降得厉害',
  '续航是最大的短板，希望下一代改进',
  '价格实在太贵了，性价比很低',
  '这个价格买不下手，同配置别家便宜一半',
  '价格劝退，功能再好也超预算了',
  '价格能降下来的话我会考虑入手',
  '客服态度非常差，问题一直没解决',
  '联系客服等了两小时都没人回复',
  '客服只会复制粘贴模板，完全不解决问题',
  '客服流程太繁琐，退货折腾了一周',
];

const smallClusterOpts = { minSamples: 3, unsafeAllowSmallClusters: true } as const;

describe('ClusteringService', () => {
  it('零 API key、零数据供应商依赖即可运行', async () => {
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    const result = await svc.cluster(TEXTS, smallClusterOpts);

    expect(result.provider).toBe('fake');
    expect(result.totalTexts).toBe(TEXTS.length);
    expect(result.cost).toBe(0);
  });

  it('把语义相近的文本聚成预期的簇', async () => {
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    const result = await svc.cluster(TEXTS, smallClusterOpts);

    expect(result.clusterCount).toBe(PROBES.length);
    expect(result.noiseCount).toBe(0);
    expect(result.clusteredTexts).toBe(TEXTS.length);
    for (const cluster of result.clusters) {
      expect(cluster.size).toBe(4);
      // 同一簇内的文本应命中同一个探针词
      const probe = PROBES.find((p) => cluster.texts[0]?.includes(p));
      expect(probe).toBeDefined();
      for (const t of cluster.texts) expect(t).toContain(probe);
    }
  });
});

describe('k-匿名下限', () => {
  it('默认 minSamples 等于 K_ANONYMITY_FLOOR', () => {
    expect(K_ANONYMITY_FLOOR).toBe(10);
  });

  it('minSamples 低于下限时拒绝执行', async () => {
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    await expect(svc.cluster(TEXTS, { minSamples: 3 })).rejects.toThrow(RangeError);
  });

  it('仅在显式声明语料不含个人数据时放行', async () => {
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    await expect(
      svc.cluster(TEXTS, { minSamples: 3, unsafeAllowSmallClusters: true }),
    ).resolves.toBeDefined();
  });

  it('默认配置下小簇不会成簇', async () => {
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    const result = await svc.cluster(TEXTS);
    // 每组只有 4 条，达不到下限 10，应全部落入噪声
    expect(result.clusterCount).toBe(0);
    expect(result.noiseCount).toBe(TEXTS.length);
  });
});
