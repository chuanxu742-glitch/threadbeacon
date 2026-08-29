// ==================== 多 Embedding 提供商架构 ====================
// 支持: 智谱AI (ZhipuAI) + OpenAI
// 用途: 灵活切换、成本优化、备用机制、A/B测试
//
// ---------------------------------------------------------------------------
// 来源：https://github.com/liangdabiao/SeekMoney-ai
//       lib/services/clustering/EmbeddingProvider.ts
// 许可：MIT，Copyright (c) 2025 liangdabiao。完整声明见仓库根目录 NOTICE。
// 本地改动：无（原样复用）。
//
// 注意：embedding 调用会把**原文**发往第三方（智谱 / OpenAI 或所配置的网关）。
// 本项目不对文本做脱敏，因此这一步等于把个人数据传给了处理者 ——
// 选供应商时要确认其数据处理条款与所在辖区，必要时改用本地 embedding。
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { setTimeout as delay } from 'node:timers/promises';

// ==================== 类型定义 ====================

/**
 * Embedding 提供商类型
 */
export type EmbeddingProviderType = 'zhipuai' | 'openai' | 'auto';

/**
 * Embedding 提供商配置
 */
export interface EmbeddingProviderConfig {
  type: EmbeddingProviderType;

  // OpenAI 配置
  openai?: {
    apiKey: string;
    model?: 'text-embedding-3-small' | 'text-embedding-3-large';
    baseURL?: string;
    timeout?: number;
    maxRetries?: number;
  };

  // 智谱AI 配置
  zhipuai?: {
    apiKey: string;
    model?: 'embedding-2' | 'embedding-3';
    baseURL?: string;
    timeout?: number;
    maxRetries?: number;
  };

}

/**
 * Embedding 结果
 */
export interface EmbeddingResult {
  text: string;
  embedding: number[];
  provider: string;
  model: string;
  dimension: number;
}

/**
 * 批量 Embedding 结果
 */
export interface BatchEmbeddingResult {
  results: EmbeddingResult[];
  totalCount: number;
  successCount: number;
  failureCount: number;
  provider: string;
  duration: number; // 毫秒
}

/**
 * 提供商统计信息
 */
export interface ProviderStats {
  provider: string;
  model: string;
  requestCount: number;
  tokenCount: number;
  successCount: number;
  failureCount: number;
  totalDuration: number;
  averageDuration: number;
  estimatedCost: number; // 预估成本 (CNY)
}

// ==================== 提供商抽象接口 ====================

/**
 * Embedding 提供商接口
 */
export interface IEmbeddingProvider {
  /**
   * 获取提供商名称
   */
  getName(): string;

  /**
   * 获取模型名称
   */
  getModel(): string;

  /**
   * 获取向量维度
   */
  getDimension(): number;

  /**
   * 获取预估成本 (每百万token)
   */
  getCostPerMillionTokens(): number;

  /**
   * 批量获取 embeddings
   */
  getEmbeddings(texts: string[]): Promise<number[][]>;

  /**
   * 检查可用性
   */
  checkAvailability(): Promise<boolean>;

  /**
   * 获取统计信息
   */
  getStats(): ProviderStats;
}

// ==================== OpenAI 提供商实现 ====================

/**
 * OpenAI Embedding 提供商
 *
 * 成本:
 * - text-embedding-3-small: ¥0.10 / 1M tokens (~$0.02 / 1M tokens)
 * - text-embedding-3-large: ¥0.65 / 1M tokens (~$0.13 / 1M tokens)
 *
 * 性能:
 * - 批处理: 最多 100 条/请求
 * - 速度: ~50-100ms/条
 * - 维度: 512 (small), 3072 (large)
 */
export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private dimension: number;
  private batchSize: number;
  private stats: ProviderStats;

  constructor(config: Required<EmbeddingProviderConfig>['openai']) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 2
    });

    this.model = config.model || 'text-embedding-3-small';
    this.dimension = this.model === 'text-embedding-3-small' ? 512 : 3072;
    this.batchSize = 100; // OpenAI 支持最大 100

    this.stats = {
      provider: 'openai',
      model: this.model,
      requestCount: 0,
      tokenCount: 0,
      successCount: 0,
      failureCount: 0,
      totalDuration: 0,
      averageDuration: 0,
      estimatedCost: 0
    };
  }

  getName(): string {
    return 'OpenAI';
  }

  getModel(): string {
    return this.model;
  }

  getDimension(): number {
    return this.dimension;
  }

  getCostPerMillionTokens(): number {
    // CNY 成本 (估算)
    if (this.model === 'text-embedding-3-small') {
      return 0.10; // ¥0.10 / 1M tokens
    }
    return 0.65; // ¥0.65 / 1M tokens
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const startTime = Date.now();
    const embeddings: number[][] = [];

    try {
      const totalBatches = Math.ceil(texts.length / this.batchSize);

      for (let i = 0; i < texts.length; i += this.batchSize) {
        const batch = texts.slice(i, i + this.batchSize);
        const batchNum = Math.floor(i / this.batchSize) + 1;

        console.log(`[OpenAI Embedding] Processing batch ${batchNum}/${totalBatches} (${batch.length} texts)`);

        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch
        });

        const batchEmbeddings = response.data.map(d => d.embedding);
        embeddings.push(...batchEmbeddings);

        // 更新统计
        this.stats.requestCount++;
        this.stats.tokenCount += response.usage?.total_tokens || 0;
      }

      const duration = Date.now() - startTime;
      this.stats.totalDuration += duration;
      this.stats.successCount += texts.length;
      this.stats.averageDuration = this.stats.totalDuration / this.stats.requestCount;
      this.stats.estimatedCost = (this.stats.tokenCount / 1_000_000) * this.getCostPerMillionTokens();

      console.log(`[OpenAI Embedding] Completed ${texts.length} texts in ${duration}ms`);
      return embeddings;

    } catch (error) {
      this.stats.failureCount += texts.length;
      console.error('[OpenAI Embedding] Error:', error);
      throw error;
    }
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: ['test']
      });
      return response.data.length > 0;
    } catch {
      return false;
    }
  }

  getStats(): ProviderStats {
    return { ...this.stats };
  }
}

// ==================== 智谱AI 提供商实现 ====================

/**
 * 智谱AI Embedding 提供商
 *
 * 成本:
 * - embedding-2: ¥0.50 / 1M tokens
 * - embedding-3: ¥0.50 / 1M tokens
 *
 * 性能:
 * - 批处理: 1 条/请求 (API 限制)
 * - 速度: ~200-500ms/条
 * - 维度: 1024
 * - 限流: 建议 0.5 秒/请求
 */
export class ZhipuAIEmbeddingProvider implements IEmbeddingProvider {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private dimension: number;
  private rateLimitDelay: number;
  private stats: ProviderStats;

  constructor(config: Required<EmbeddingProviderConfig>['zhipuai']) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://open.bigmodel.cn/api/paas/v4/embeddings';
    this.model = config.model || 'embedding-3';
    this.dimension = 1024; // 智谱AI embedding 维度
    this.rateLimitDelay = 500; // 0.5 秒延迟

    this.stats = {
      provider: 'zhipuai',
      model: this.model,
      requestCount: 0,
      tokenCount: 0,
      successCount: 0,
      failureCount: 0,
      totalDuration: 0,
      averageDuration: 0,
      estimatedCost: 0
    };
  }

  getName(): string {
    return 'ZhipuAI';
  }

  getModel(): string {
    return this.model;
  }

  getDimension(): number {
    return this.dimension;
  }

  getCostPerMillionTokens(): number {
    return 0.50; // ¥0.50 / 1M tokens
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const startTime = Date.now();
    const embeddings: number[][] = [];

    try {
      console.log(`[ZhipuAI Embedding] Processing ${texts.length} texts (1 by 1 due to API limit)`);

      // 智谱AI 需要逐个请求
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];

        console.log(`[ZhipuAI Embedding] Processing ${i + 1}/${texts.length}`);

        const response = await fetch(this.baseURL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            input: text
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`ZhipuAI API error: ${response.status} - ${errorText}`);
        }

        const result = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
        const embedding = result.data?.[0]?.embedding;
        if (!embedding) {
          throw new Error(`ZhipuAI API 返回中缺少 embedding 字段：${JSON.stringify(result).slice(0, 200)}`);
        }
        embeddings.push(embedding);

        // 更新统计
        this.stats.requestCount++;
        this.stats.successCount++;

        // 限流延迟 (除了最后一个请求)
        if (i < texts.length - 1) {
          await delay(this.rateLimitDelay);
        }
      }

      const duration = Date.now() - startTime;
      this.stats.totalDuration += duration;
      this.stats.averageDuration = this.stats.totalDuration / this.stats.requestCount;
      // 智谱AI 按 token 数计费，这里简单估算 (假设平均每个文本 50 tokens)
      this.stats.tokenCount = texts.length * 50;
      this.stats.estimatedCost = (this.stats.tokenCount / 1_000_000) * this.getCostPerMillionTokens();

      console.log(`[ZhipuAI Embedding] Completed ${texts.length} texts in ${duration}ms`);
      return embeddings;

    } catch (error) {
      this.stats.failureCount += texts.length;
      console.error('[ZhipuAI Embedding] Error:', error);
      throw error;
    }
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          input: 'test'
        })
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getStats(): ProviderStats {
    return { ...this.stats };
  }

}

// ==================== 自动/智能提供商 ====================

/**
 * 自动 Embedding 提供商
 * 根据成本、性能自动选择最优提供商
 */
export class AutoEmbeddingProvider implements IEmbeddingProvider {
  private providers: Map<string, IEmbeddingProvider>;
  private currentProvider: IEmbeddingProvider;

  constructor(
    openaiConfig: Required<EmbeddingProviderConfig>['openai'],
    zhipuaiConfig: Required<EmbeddingProviderConfig>['zhipuai']
  ) {
    this.providers = new Map();

    // 创建 OpenAI 提供商
    if (openaiConfig.apiKey) {
      this.providers.set('openai', new OpenAIEmbeddingProvider(openaiConfig));
    }

    // 创建智谱AI 提供商
    if (zhipuaiConfig.apiKey) {
      this.providers.set('zhipuai', new ZhipuAIEmbeddingProvider(zhipuaiConfig));
    }

    // 默认使用 OpenAI (成本更低，速度更快)
    this.currentProvider = this.providers.get('openai') || this.providers.get('zhipuai')!;
  }

  getName(): string {
    return 'Auto';
  }

  getModel(): string {
    return this.currentProvider.getModel();
  }

  getDimension(): number {
    return this.currentProvider.getDimension();
  }

  getCostPerMillionTokens(): number {
    return this.currentProvider.getCostPerMillionTokens();
  }

  /**
   * 自动选择最优提供商
   * 优先级: 可用性 > 成本 > 速度
   */
  private async selectBestProvider(): Promise<IEmbeddingProvider> {
    // 如果当前提供商可用，继续使用
    const currentAvailable = await this.currentProvider.checkAvailability();
    if (currentAvailable) {
      return this.currentProvider;
    }

    // 否则切换到其他可用提供商
    const entries = Array.from(this.providers.entries());
    for (const [name, provider] of entries) {
      if (provider !== this.currentProvider) {
        const available = await provider.checkAvailability();
        if (available) {
          console.log(`[Auto Embedding] Switching from ${this.currentProvider.getName()} to ${name}`);
          this.currentProvider = provider;
          return provider;
        }
      }
    }

    // 如果都不可用，返回当前提供商 (让错误发生)
    return this.currentProvider;
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const provider = await this.selectBestProvider();
    return await provider.getEmbeddings(texts);
  }

  async checkAvailability(): Promise<boolean> {
    const entries = Array.from(this.providers.values());
    for (const provider of entries) {
      const available = await provider.checkAvailability();
      if (available) return true;
    }
    return false;
  }

  getStats(): ProviderStats {
    return this.currentProvider.getStats();
  }

}

// ==================== 工厂函数 ====================

/**
 * 创建 Embedding 提供商
 */
export function createEmbeddingProvider(
  config: EmbeddingProviderConfig
): IEmbeddingProvider {
  switch (config.type) {
    case 'openai':
      if (!config.openai?.apiKey) {
        throw new Error('OpenAI API key is required');
      }
      return new OpenAIEmbeddingProvider(config.openai as Required<NonNullable<typeof config.openai>>);

    case 'zhipuai':
      if (!config.zhipuai?.apiKey) {
        throw new Error('ZhipuAI API key is required');
      }
      return new ZhipuAIEmbeddingProvider(config.zhipuai as Required<NonNullable<typeof config.zhipuai>>);

    case 'auto':
      return new AutoEmbeddingProvider(
        config.openai || { apiKey: '' },
        config.zhipuai || { apiKey: '' }
      );

    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

// ==================== 辅助函数 ====================

/**
 * 从环境变量创建配置
 */
export function createConfigFromEnv(): EmbeddingProviderConfig {
  return {
    type: (process.env.EMBEDDING_PROVIDER as EmbeddingProviderType) || 'auto',
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: (process.env.OPENAI_EMBEDDING_MODEL as any) || 'text-embedding-3-small',
      baseURL: process.env.OPENAI_BASE_URL
    },
    zhipuai: {
      apiKey: process.env.GLM_API_KEY || '',
      model: (process.env.GLM_EMBEDDING_MODEL as any) || 'embedding-3',
      baseURL: process.env.GLM_BASE_EMBEDDING_URL
    }
  };
}
