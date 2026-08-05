// LLM 接入层的统一契约。
//
// 目标：调用方只提供 url + key + model，两种线路格式（OpenAI 兼容 / Anthropic Messages）
// 走同一个接口。两条链路各用各的官方 SDK —— 不把 Claude 塞进 OpenAI 兼容层，
// 因为那会丢掉 Anthropic 特有语义：system 是顶层参数而非消息、max_tokens 必填、
// stop_reason 可能是 refusal、content 是块数组而非字符串。

/** 线路格式。决定请求怎么拼、响应怎么解，与「用哪家模型」是两回事。 */
export type WireFormat = 'openai' | 'anthropic';

export interface LlmConfig {
  /**
   * 线路格式。省略时由 detectFormat() 从 model 与 baseUrl 推断。
   * 推断只是便利，接第三方网关时建议显式指定。
   */
  readonly format?: WireFormat;
  /**
   * 自定义 API 基址。省略则用 SDK 默认官方端点。
   * OpenAI 兼容网关通常填到 `/v1` 为止，例如 https://open.bigmodel.cn/api/paas/v4
   */
  readonly baseUrl?: string;
  readonly apiKey: string;
  /** 模型 ID，原样透传。 */
  readonly model: string;
  /**
   * 输出上限。Anthropic 侧**必填**，所以这里总会落到一个默认值。
   * 非流式建议 ≤16000，避免 SDK HTTP 超时。
   */
  readonly maxTokens?: number;
  /**
   * 思考模式，仅 Anthropic 线路有效。
   *
   * 默认策略：走官方端点时用 'adaptive'，指定了自定义 baseUrl 时用 'off' ——
   * 第三方网关未必透传 thinking 参数，贸然发送会 400。
   */
  readonly thinking?: 'adaptive' | 'off';
  /**
   * 采样温度，**仅 OpenAI 线路生效**。
   * Anthropic 当前模型（Opus 5 / Fable 5 / Opus 4.8 / 4.7 等）已移除 temperature，
   * 发送会返回 400，因此 Anthropic 适配器会忽略此字段。
   */
  readonly temperature?: number;
  readonly timeoutMs?: number;
}

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ChatRequest {
  /** 系统提示。OpenAI 侧转成首条 system 消息，Anthropic 侧放顶层 system 参数。 */
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
  /** 覆盖 LlmConfig.maxTokens。 */
  readonly maxTokens?: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmResult {
  readonly text: string;
  /** 实际服务的模型，取自响应而非请求 —— 网关可能改写。 */
  readonly model: string;
  readonly usage: TokenUsage;
  readonly stopReason: string | null;
  /**
   * 是否被安全分类器拒绝。
   *
   * Anthropic 的拒答返回 HTTP 200 + stop_reason='refusal'，content 可能为空，
   * 直接读 content[0] 会炸。调用方必须先看这个字段。
   * OpenAI 线路恒为 false（其拒答表现为正常文本）。
   */
  readonly refused: boolean;
}

export interface ILlmClient {
  readonly format: WireFormat;
  readonly model: string;
  complete(req: ChatRequest): Promise<LlmResult>;
}

/** Anthropic 侧 max_tokens 必填，这是兜底值。非流式下不宜再大，否则易触发 HTTP 超时。 */
export const DEFAULT_MAX_TOKENS = 16000;

/**
 * 从 model 与 baseUrl 推断线路格式。
 *
 * 判据只用 model 前缀和 baseUrl 主机名里的 anthropic 字样 ——
 * 刻意保守，推断不出就归为 openai（兼容网关是多数情况）。
 */
export function detectFormat(cfg: Pick<LlmConfig, 'model' | 'baseUrl'>): WireFormat {
  if (cfg.model.startsWith('claude-')) return 'anthropic';
  if (cfg.baseUrl !== undefined) {
    try {
      if (new URL(cfg.baseUrl).hostname.includes('anthropic')) return 'anthropic';
    } catch {
      // baseUrl 非法留给 SDK 报错，这里不抢着抛
    }
  }
  return 'openai';
}

/** thinking 的默认取值：官方端点开 adaptive，自定义网关关掉。 */
export function defaultThinking(cfg: Pick<LlmConfig, 'baseUrl' | 'thinking'>): 'adaptive' | 'off' {
  if (cfg.thinking !== undefined) return cfg.thinking;
  return cfg.baseUrl === undefined ? 'adaptive' : 'off';
}
