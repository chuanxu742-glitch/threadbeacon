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
  if (!cfg.apiKey) {
    throw new RangeError('createLlmClient(): apiKey 不能为空');
  }
  if (!cfg.model) {
    throw new RangeError('createLlmClient(): model 不能为空');
  }

  const format = cfg.format ?? detectFormat(cfg);
  switch (format) {
    case 'anthropic':
      return new AnthropicLlmClient(cfg);
    case 'openai':
      return new OpenAILlmClient(cfg);
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

  const maxTokens = env['LLM_MAX_TOKENS'];
  return {
    apiKey,
    model,
    ...(format !== undefined ? { format } : {}),
    ...(env['LLM_BASE_URL'] ? { baseUrl: env['LLM_BASE_URL'] } : {}),
    ...(maxTokens ? { maxTokens: Number.parseInt(maxTokens, 10) } : {}),
  };
}

export { AnthropicLlmClient } from './anthropic.js';
export { OpenAILlmClient } from './openai.js';
export * from './types.js';
