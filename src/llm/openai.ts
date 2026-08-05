// OpenAI 兼容线路适配器。
//
// 覆盖 OpenAI 官方端点，以及所有 chat/completions 兼容网关
// （智谱 GLM、DeepSeek、各类中转）。用 baseUrl 指向即可。

import OpenAI from 'openai';
import {
  DEFAULT_MAX_TOKENS,
  type ChatRequest,
  type ILlmClient,
  type LlmConfig,
  type LlmResult,
  type WireFormat,
} from './types.js';

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type ChatResponse = OpenAI.Chat.Completions.ChatCompletion;

/** 只暴露本适配器用到的那一个方法，便于测试注入假实现。 */
export interface OpenAIChatPort {
  create(params: ChatParams): Promise<ChatResponse>;
}

export class OpenAILlmClient implements ILlmClient {
  readonly format: WireFormat = 'openai';
  readonly model: string;

  private readonly chat: OpenAIChatPort;
  private readonly maxTokens: number;
  private readonly temperature: number | undefined;

  constructor(cfg: LlmConfig, port?: OpenAIChatPort) {
    this.model = cfg.model;
    this.maxTokens = cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = cfg.temperature;
    this.chat =
      port ??
      new OpenAI({
        apiKey: cfg.apiKey,
        ...(cfg.baseUrl !== undefined ? { baseURL: cfg.baseUrl } : {}),
        ...(cfg.timeoutMs !== undefined ? { timeout: cfg.timeoutMs } : {}),
      }).chat.completions;
  }

  async complete(req: ChatRequest): Promise<LlmResult> {
    if (req.messages.length === 0) {
      throw new RangeError('complete(): messages 不能为空');
    }

    // system 在这条线路上是首条消息，与 Anthropic 的顶层参数相反
    const messages: ChatParams['messages'] = [
      ...(req.system !== undefined ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const res = await this.chat.create({
      model: this.model,
      max_tokens: req.maxTokens ?? this.maxTokens,
      messages,
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
    });

    const choice = res.choices[0];
    if (!choice) {
      throw new Error(`OpenAI 兼容端点返回了空 choices：${JSON.stringify(res).slice(0, 200)}`);
    }

    return {
      text: choice.message.content ?? '',
      model: res.model,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
      stopReason: choice.finish_reason ?? null,
      // OpenAI 线路没有独立的拒答信号，模型拒绝表现为普通文本
      refused: false,
    };
  }
}
