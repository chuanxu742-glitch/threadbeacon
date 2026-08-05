// Anthropic Messages 线路适配器。
//
// 用官方 @anthropic-ai/sdk，不手写 HTTP。与 OpenAI 线路的实质差异：
//   1. system 是顶层参数，不是 messages 里的一条
//   2. max_tokens 必填
//   3. content 是内容块数组，要按 type 收敛后才能取 text
//   4. 拒答走 HTTP 200 + stop_reason='refusal'，content 可能为空
//   5. 当前模型已移除 temperature / top_p / top_k，发送即 400

import Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_MAX_TOKENS,
  defaultThinking,
  type ChatRequest,
  type ILlmClient,
  type LlmConfig,
  type LlmResult,
  type WireFormat,
} from './types.js';

/** 只暴露本适配器用到的那一个方法，便于测试注入假实现。 */
export interface AnthropicMessagesPort {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export class AnthropicLlmClient implements ILlmClient {
  readonly format: WireFormat = 'anthropic';
  readonly model: string;

  private readonly messages: AnthropicMessagesPort;
  private readonly maxTokens: number;
  private readonly thinking: 'adaptive' | 'off';

  constructor(cfg: LlmConfig, port?: AnthropicMessagesPort) {
    this.model = cfg.model;
    this.maxTokens = cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.thinking = defaultThinking(cfg);
    this.messages =
      port ??
      new Anthropic({
        apiKey: cfg.apiKey,
        ...(cfg.baseUrl !== undefined ? { baseURL: cfg.baseUrl } : {}),
        ...(cfg.timeoutMs !== undefined ? { timeout: cfg.timeoutMs } : {}),
      }).messages;
  }

  async complete(req: ChatRequest): Promise<LlmResult> {
    if (req.messages.length === 0) {
      throw new RangeError('complete(): messages 不能为空');
    }

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: req.maxTokens ?? this.maxTokens,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      // system 走顶层，不混进 messages
      ...(req.system !== undefined ? { system: req.system } : {}),
      ...(this.thinking === 'adaptive' ? { thinking: { type: 'adaptive' as const } } : {}),
    };

    const res = await this.messages.create(params);
    const refused = res.stop_reason === 'refusal';

    return {
      // 拒答时 content 可能是空数组，textOf 会安全返回 ''
      text: refused ? '' : textOf(res.content),
      model: res.model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      },
      stopReason: res.stop_reason,
      refused,
    };
  }
}

/** 内容块是可辨识联合，只取 text 块并拼接。 */
function textOf(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
