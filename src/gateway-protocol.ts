export const GATEWAY_PROTOCOL_VERSION = 1 as const;

export interface GatewayJob {
  id: string; platform: string; keyword: string; source_options_json: string; limit: number; include_comments: number; attempt: number;
}
export type AgentToGatewayMessage =
  | { type: 'register'; protocolVersion: 1; agentId: string; capabilities: string[]; maxConcurrency: number }
  | { type: 'heartbeat'; activeJobs: number; sentAt: string }
  | { type: 'ack'; jobId: string }
  | { type: 'result'; jobId: string; report: unknown }
  | { type: 'error'; jobId: string; error: string };
export type GatewayToAgentMessage =
  | { type: 'registered'; protocolVersion: 1; heartbeatIntervalMs: number }
  | { type: 'job'; job: GatewayJob }
  | { type: 'cancel'; jobId: string; reason: string }
  | { type: 'ping'; sentAt: string };

export function parseGatewayJob(input: unknown): GatewayJob {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('job 必须是 JSON 对象');
  const value = input as Record<string, unknown>; const id = typeof value['id'] === 'string' ? value['id'].trim() : '';
  const platform = typeof value['platform'] === 'string' ? value['platform'].trim() : ''; const keyword = typeof value['keyword'] === 'string' ? value['keyword'].trim() : '';
  const limit = Number(value['limit'] ?? 100); const attempt = Number(value['attempt'] ?? 1); const sourceOptions = typeof value['source_options_json'] === 'string' ? value['source_options_json'] : '{}';
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) throw new RangeError('job.id 无效');
  if (!/^[a-z0-9][a-z0-9:._-]{0,79}$/.test(platform)) throw new RangeError('job.platform 无效');
  if (!keyword || keyword.length > 200) throw new RangeError('job.keyword 长度必须是 1-200');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('job.limit 必须是 1-1000');
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 100) throw new RangeError('job.attempt 必须是 1-100');
  if (sourceOptions.length > 100_000) throw new RangeError('source_options_json 过大');
  try { JSON.parse(sourceOptions); } catch { throw new TypeError('source_options_json 不是合法 JSON'); }
  return { id, platform, keyword, source_options_json: sourceOptions, limit, include_comments: value['include_comments'] === 0 ? 0 : 1, attempt };
}

export function parseAgentMessage(input: unknown): AgentToGatewayMessage {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('协议消息必须是 JSON 对象');
  const value = input as Record<string, unknown>; const type = value['type'];
  if (type === 'register') {
    const agentId = typeof value['agentId'] === 'string' ? value['agentId'].trim() : '';
    if (value['protocolVersion'] !== 1 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$/.test(agentId)) throw new RangeError('Agent 注册信息无效');
    const capabilities = Array.isArray(value['capabilities']) ? [...new Set(value['capabilities'].filter((item): item is string => typeof item === 'string' && /^[a-z0-9][a-z0-9:._-]{0,79}$/.test(item)))].slice(0, 500) : [];
    const maxConcurrency = Number(value['maxConcurrency']); if (!capabilities.length || !Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 64) throw new RangeError('Agent 能力或并发无效');
    return { type, protocolVersion: 1, agentId, capabilities, maxConcurrency };
  }
  if (type === 'heartbeat') return { type, activeJobs: Math.max(0, Math.min(64, Number(value['activeJobs']) || 0)), sentAt: typeof value['sentAt'] === 'string' ? value['sentAt'] : new Date().toISOString() };
  const jobId = typeof value['jobId'] === 'string' ? value['jobId'] : ''; if (!jobId) throw new RangeError('协议消息缺少 jobId');
  if (type === 'ack') return { type, jobId };
  if (type === 'result') { if (!value['report'] || typeof value['report'] !== 'object') throw new TypeError('result 缺少 report'); return { type, jobId, report: value['report'] }; }
  if (type === 'error') return { type, jobId, error: typeof value['error'] === 'string' ? value['error'].slice(0, 1000) : 'Agent 执行失败' };
  throw new RangeError('未知 Gateway 协议消息');
}
