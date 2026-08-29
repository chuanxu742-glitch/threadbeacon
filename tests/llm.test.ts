import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { AnthropicLlmClient, type AnthropicMessagesPort } from '../src/llm/anthropic.js';
import { OpenAILlmClient, type OpenAIChatPort } from '../src/llm/openai.js';
import { createLlmClient, llmConfigFromEnv } from '../src/llm/index.js';
import { detectFormat, defaultThinking, DEFAULT_MAX_TOKENS } from '../src/llm/types.js';

// 测试替身只需覆盖被断言的字段，其余由响应类型的可选部分兜底。
function anthropicReply(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: 'hi', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 11, output_tokens: 7 },
    ...over,
  } as unknown as Anthropic.Message;
}

function openaiReply(
  over: Partial<OpenAI.Chat.Completions.ChatCompletion> = {},
): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'cmpl_1',
    object: 'chat.completion',
    created: 0,
    model: 'glm-4.6',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop', logprobs: null },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    ...over,
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

/** 记录最后一次请求参数的假端口。 */
function spyPort<P, R>(reply: R) {
  const calls: P[] = [];
  const port = {
    create: async (params: P): Promise<R> => {
      calls.push(params);
      return reply;
    },
  };
  return { port, calls };
}

describe('detectFormat', () => {
  it('claude- 前缀的模型判为 anthropic', () => {
    expect(detectFormat({ model: 'claude-opus-5' })).toBe('anthropic');
  });

  it('baseUrl 主机名含 anthropic 判为 anthropic', () => {
    expect(detectFormat({ model: 'x', baseUrl: 'https://api.anthropic.com' })).toBe('anthropic');
  });

  it('推断不出时保守归为 openai', () => {
    expect(detectFormat({ model: 'glm-4.6', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' })).toBe(
      'openai',
    );
  });

  it('非法 baseUrl 不抛错，留给 SDK 处理', () => {
    expect(detectFormat({ model: 'glm-4.6', baseUrl: 'not a url' })).toBe('openai');
  });
});

describe('defaultThinking', () => {
  it('官方端点默认开 adaptive', () => {
    expect(defaultThinking({})).toBe('adaptive');
  });

  it('自定义 baseUrl 默认关闭，避免网关不认 thinking 参数', () => {
    expect(defaultThinking({ baseUrl: 'https://gateway.example/v1' })).toBe('off');
  });

  it('显式配置优先于默认策略', () => {
    expect(defaultThinking({ baseUrl: 'https://gateway.example/v1', thinking: 'adaptive' })).toBe(
      'adaptive',
    );
  });
});

describe('AnthropicLlmClient', () => {
  it('把 system 放顶层参数，不混进 messages', async () => {
    const { port, calls } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply(),
    );
    const llm = new AnthropicLlmClient({ apiKey: 'k', model: 'claude-opus-5' }, port);

    await llm.complete({ system: 'you are terse', messages: [{ role: 'user', content: 'hi' }] });

    const sent = calls[0]!;
    expect(sent.system).toBe('you are terse');
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages.every((m) => m.role !== ('system' as unknown))).toBe(true);
  });

  it('总是带上 max_tokens（Anthropic 侧必填）', async () => {
    const { port, calls } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply(),
    );
    const llm = new AnthropicLlmClient({ apiKey: 'k', model: 'claude-opus-5' }, port);

    await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0]!.max_tokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it('单次请求可覆盖 maxTokens', async () => {
    const { port, calls } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply(),
    );
    const llm = new AnthropicLlmClient({ apiKey: 'k', model: 'claude-opus-5', maxTokens: 100 }, port);

    await llm.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 250 });
    expect(calls[0]!.max_tokens).toBe(250);
  });

  it('自定义 baseUrl 时不发送 thinking 参数', async () => {
    const { port, calls } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply(),
    );
    const llm = new AnthropicLlmClient(
      { apiKey: 'k', model: 'claude-opus-5', baseUrl: 'https://gateway.example' },
      port,
    );

    await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0]!.thinking).toBeUndefined();
  });

  it('绝不发送 temperature —— 当前 Anthropic 模型会因此 400', async () => {
    const { port, calls } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply(),
    );
    const llm = new AnthropicLlmClient(
      { apiKey: 'k', model: 'claude-opus-5', temperature: 0.7 },
      port,
    );

    await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0]!.temperature).toBeUndefined();
  });

  it('只拼接 text 块，忽略 thinking 等其他块', async () => {
    const { port } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply({
        content: [
          { type: 'thinking', thinking: '', signature: '' },
          { type: 'text', text: 'A', citations: null },
          { type: 'text', text: 'B', citations: null },
        ] as unknown as Anthropic.ContentBlock[],
      }),
    );
    const llm = new AnthropicLlmClient({ apiKey: 'k', model: 'claude-opus-5' }, port);

    const out = await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out.text).toBe('AB');
  });

  it('拒答时标记 refused 且不因空 content 崩溃', async () => {
    const { port } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply({ stop_reason: 'refusal', content: [] }),
    );
    const llm = new AnthropicLlmClient({ apiKey: 'k', model: 'claude-opus-5' }, port);

    const out = await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out.refused).toBe(true);
    expect(out.stopReason).toBe('refusal');
    expect(out.text).toBe('');
  });

  it('映射 usage 字段名', async () => {
    const { port } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply(),
    );
    const llm = new AnthropicLlmClient({ apiKey: 'k', model: 'claude-opus-5' }, port);

    const out = await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it('拒绝空 messages', async () => {
    const { port } = spyPort<Anthropic.MessageCreateParamsNonStreaming, Anthropic.Message>(
      anthropicReply(),
    );
    const llm = new AnthropicLlmClient({ apiKey: 'k', model: 'claude-opus-5' }, port);
    await expect(llm.complete({ messages: [] })).rejects.toThrow(RangeError);
  });
});

describe('OpenAILlmClient', () => {
  it('把 system 转成首条消息', async () => {
    const { port, calls } = spyPort<
      OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      OpenAI.Chat.Completions.ChatCompletion
    >(openaiReply());
    const llm = new OpenAILlmClient({ apiKey: 'k', model: 'glm-4.6' }, port);

    await llm.complete({ system: 'you are terse', messages: [{ role: 'user', content: 'hi' }] });

    const sent = calls[0]!;
    expect(sent.messages).toHaveLength(2);
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'you are terse' });
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('传递 temperature（这条线路支持）', async () => {
    const { port, calls } = spyPort<
      OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      OpenAI.Chat.Completions.ChatCompletion
    >(openaiReply());
    const llm = new OpenAILlmClient({ apiKey: 'k', model: 'glm-4.6', temperature: 0.3 }, port);

    await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0]!.temperature).toBe(0.3);
  });

  it('映射 usage 字段名并取响应里的实际模型', async () => {
    const { port } = spyPort<
      OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      OpenAI.Chat.Completions.ChatCompletion
    >(openaiReply({ model: 'glm-4.6-actual' }));
    const llm = new OpenAILlmClient({ apiKey: 'k', model: 'glm-4.6' }, port);

    const out = await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    expect(out.model).toBe('glm-4.6-actual');
    expect(out.refused).toBe(false);
  });

  it('choices 为空时报错而不是静默返回空串', async () => {
    const { port } = spyPort<
      OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      OpenAI.Chat.Completions.ChatCompletion
    >(openaiReply({ choices: [] }));
    const llm = new OpenAILlmClient({ apiKey: 'k', model: 'glm-4.6' }, port);

    await expect(llm.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      /空 choices/,
    );
  });
});

describe('createLlmClient', () => {
  it('按 model 前缀路由到 anthropic 线路', () => {
    expect(createLlmClient({ apiKey: 'k', model: 'claude-opus-5' }).format).toBe('anthropic');
  });

  it('默认路由到 openai 线路', () => {
    expect(
      createLlmClient({ apiKey: 'k', model: 'glm-4.6', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' })
        .format,
    ).toBe('openai');
  });

  it('显式 format 覆盖推断', () => {
    expect(createLlmClient({ apiKey: 'k', model: 'claude-opus-5', format: 'openai' }).format).toBe(
      'openai',
    );
  });

  it('缺 apiKey 或 model 时拒绝构造', () => {
    expect(() => createLlmClient({ apiKey: '', model: 'm' })).toThrow(RangeError);
    expect(() => createLlmClient({ apiKey: 'k', model: '' })).toThrow(RangeError);
  });
});

describe('llmConfigFromEnv', () => {
  it('读取 url / key / model 三项', () => {
    const cfg = llmConfigFromEnv({
      LLM_API_KEY: 'k',
      LLM_MODEL: 'glm-4.6',
      LLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
      LLM_MAX_TOKENS: '2048',
      LLM_TIMEOUT_MS: '30000',
      LLM_TEMPERATURE: '0.2',
      LLM_THINKING: 'off',
    });
    expect(cfg).toEqual({
      apiKey: 'k',
      model: 'glm-4.6',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      maxTokens: 2048,
      timeoutMs: 30000,
      temperature: 0.2,
      thinking: 'off',
    });
  });

  it('缺必填项时报出具体缺哪个', () => {
    expect(() => llmConfigFromEnv({ LLM_MODEL: 'm' })).toThrow(/LLM_API_KEY/);
    expect(() => llmConfigFromEnv({ LLM_API_KEY: 'k' })).toThrow(/LLM_MODEL/);
  });

  it('拒绝非法的 LLM_FORMAT', () => {
    expect(() =>
      llmConfigFromEnv({ LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_FORMAT: 'gemini' }),
    ).toThrow(/openai \| anthropic/);
  });

  it('在 SDK 构造前拒绝非法数字与 URL', () => {
    const base = { LLM_API_KEY: 'k', LLM_MODEL: 'm' };
    expect(() => llmConfigFromEnv({ ...base, LLM_MAX_TOKENS: 'abc' })).toThrow(
      /LLM_MAX_TOKENS/,
    );
    expect(() => llmConfigFromEnv({ ...base, LLM_TIMEOUT_MS: '0' })).toThrow(/LLM_TIMEOUT_MS/);
    expect(() => llmConfigFromEnv({ ...base, LLM_TEMPERATURE: '3' })).toThrow(/LLM_TEMPERATURE/);
    expect(() => llmConfigFromEnv({ ...base, LLM_BASE_URL: 'file:///tmp/model' })).toThrow(
      /http\/https/,
    );
  });

  it('createLlmClient 同样校验直接传入的配置', () => {
    expect(() => createLlmClient({ apiKey: ' ', model: 'm' })).toThrow(/apiKey/);
    expect(() => createLlmClient({ apiKey: 'k', model: 'm', maxTokens: 0 })).toThrow(/maxTokens/);
    expect(() => createLlmClient({ apiKey: 'k', model: 'm', timeoutMs: -1 })).toThrow(/timeoutMs/);
  });
});
