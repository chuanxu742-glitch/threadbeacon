// LLM 接入层入口。
//
// 用法：
//   const llm = createLlmClient({
//     apiKey: process.env.LLM_API_KEY!,
//     model: 'claude-opus-5',
//   });
//
//   const llm = createLlmClient({
//     baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
//     apiKey: process.env.LLM_API_KEY!,
//     model: 'glm-4.6',
//   });
//
// 格式未显式指定时由 model 前缀与 baseUrl 主机名推断；接第三方网关建议显式写 format。

import { AnthropicLlmClient } from './anthropic.js';
import { OpenAILlmClient } from './openai.js';
import { detectFormat, type ILlmClient, type LlmConfig } from './types.js';

export function createLlmClient(cfg: LlmConfig): ILlmClient {
  if (!cfg.apiKey.trim()) {
    throw new RangeError('createLlmClient(): apiKey 不能为空');
  }
  if (!cfg.model.trim()) {
    throw new RangeError('createLlmClient(): model 不能为空');
  }
  if (cfg.maxTokens !== undefined) positiveInteger('maxTokens', cfg.maxTokens);
  if (cfg.timeoutMs !== undefined) positiveInteger('timeoutMs', cfg.timeoutMs);
  if (
    cfg.temperature !== undefined &&
    (!Number.isFinite(cfg.temperature) || cfg.temperature < 0 || cfg.temperature > 2)
  ) {
    throw new RangeError(`temperature 必须在 0-2 之间，收到 ${cfg.temperature}`);
  }
  if (cfg.baseUrl !== undefined) assertHttpUrl('baseUrl', cfg.baseUrl);

  const format = cfg.format ?? detectFormat(cfg);
  switch (format) {
    case 'anthropic':
      return new AnthropicLlmClient(cfg);
    case 'openai':
      return new OpenAILlmClient(cfg);
  }
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} 必须是正整数，收到 ${value}`);
  }
  return value;
}

function numberFromEnv(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new RangeError(`${name} 必须是数字，收到 "${raw}"`);
  return value;
}

function assertHttpUrl(name: string, raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RangeError(`${name} 必须是合法 URL，收到 "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RangeError(`${name} 只支持 http/https，收到 "${url.protocol}"`);
  }
}

/** 从环境变量装配。空值一律不写入，让下游的默认值生效。 */
export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const apiKey = env['LLM_API_KEY'];
  const model = env['LLM_MODEL'];
  if (!apiKey) throw new RangeError('缺少环境变量 LLM_API_KEY');
  if (!model) throw new RangeError('缺少环境变量 LLM_MODEL');

  const format = env['LLM_FORMAT'];
  if (format !== undefined && format !== 'openai' && format !== 'anthropic') {
    throw new RangeError(`LLM_FORMAT 只接受 openai | anthropic，收到 "${format}"`);
  }

  const thinking = env['LLM_THINKING'];
  if (thinking !== undefined && thinking !== 'adaptive' && thinking !== 'off') {
    throw new RangeError(`LLM_THINKING 只接受 adaptive | off，收到 "${thinking}"`);
  }

  const maxTokens = numberFromEnv('LLM_MAX_TOKENS', env['LLM_MAX_TOKENS']);
  const timeoutMs = numberFromEnv('LLM_TIMEOUT_MS', env['LLM_TIMEOUT_MS']);
  const temperature = numberFromEnv('LLM_TEMPERATURE', env['LLM_TEMPERATURE']);
  if (maxTokens !== undefined) positiveInteger('LLM_MAX_TOKENS', maxTokens);
  if (timeoutMs !== undefined) positiveInteger('LLM_TIMEOUT_MS', timeoutMs);
  const baseUrl = env['LLM_BASE_URL'];
  if (baseUrl) assertHttpUrl('LLM_BASE_URL', baseUrl);

  const cfg: LlmConfig = {
    apiKey,
    model,
    ...(format !== undefined ? { format } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
  };
  // 环境配置在真正构造 SDK 前就给出一致、可操作的错误。
  if (cfg.temperature !== undefined && (cfg.temperature < 0 || cfg.temperature > 2)) {
    throw new RangeError(`LLM_TEMPERATURE 必须在 0-2 之间，收到 ${cfg.temperature}`);
  }
  return cfg;
}

export { AnthropicLlmClient } from './anthropic.js';
export { OpenAILlmClient } from './openai.js';
export * from './types.js';
