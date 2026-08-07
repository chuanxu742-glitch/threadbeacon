import { describe, expect, it } from 'vitest';
import { ClusteringService, DEFAULT_MIN_SAMPLES } from '../src/clustering/ClusteringService.js';
import { DataCleaner } from '../src/clustering/DataCleaner.js';
import { FakeEmbeddingProvider } from './helpers/fakeEmbedding.js';

const PROBES = ['续航', '价格', '客服'] as const;

/** 三个主题各 4 条。 */
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

const opts = { minSamples: 3 } as const;

describe('ClusteringService', () => {
  it('零 API key、零数据供应商依赖即可运行', async () => {
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    const result = await svc.cluster(TEXTS, opts);

    expect(result.provider).toBe('fake');
    expect(result.totalTexts).toBe(TEXTS.length);
    expect(result.cost).toBe(0);
  });

  it('把语义相近的文本聚成预期的簇', async () => {
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    const result = await svc.cluster(TEXTS, opts);

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

  it('默认 minSamples 是 2，小簇照样成簇', async () => {
    expect(DEFAULT_MIN_SAMPLES).toBe(2);
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    const result = await svc.cluster(TEXTS);
    expect(result.clusterCount).toBe(PROBES.length);
  });

  it('indices 指回原始输入数组，不受清洗过滤影响', async () => {
    // 掺入会被清洗掉的噪音，使清洗后下标与原始下标错位
    const noisy = ['!!!', ...TEXTS.slice(0, 4), '哈哈', ...TEXTS.slice(4)];
    const svc = new ClusteringService(new FakeEmbeddingProvider(PROBES));
    const result = await svc.cluster(noisy, opts);

    for (const cluster of result.clusters) {
      expect(cluster.indices).toHaveLength(cluster.size);
      // indices[i] 指向的原始文本必须就是 texts[i]
      cluster.indices.forEach((origin, i) => {
        expect(noisy[origin]).toBe(cluster.texts[i]);
      });
    }
  });
});

describe('DataCleaner', () => {
  it('clean 返回保留项在原始数组里的下标', () => {
    const cleaner = new DataCleaner();
    const input = ['!!!', '这个手机续航太差了，一天要充两次电', '哈哈', '价格实在太贵了，性价比很低'];
    const out = cleaner.clean(input);

    expect(out.texts).toHaveLength(out.indices.length);
    out.indices.forEach((origin, i) => {
      expect(input[origin]).toBe(out.texts[i]);
    });
  });

  it('去重后下标仍指向首次出现的位置', () => {
    const cleaner = new DataCleaner();
    const dup = '这个手机续航太差了，一天要充两次电';
    const out = cleaner.clean([dup, dup]);

    expect(out.texts).toHaveLength(1);
    expect(out.indices).toEqual([0]);
  });
});
