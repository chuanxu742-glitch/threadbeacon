export type JsonRecord = Record<string, unknown>;

export class V2ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly correlationId: string;

  constructor(message: string, status = 0, code = 'unknown_error', details: unknown = undefined, correlationId = '') {
    super(message);
    this.name = 'V2ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.correlationId = correlationId;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageFrom(body: unknown, status: number): string {
  if (isRecord(body)) {
    const message = body.message ?? body.error ?? body.title;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (status === 404) return '该 v2 能力尚未在当前控制平面启用。';
  if (status === 401 || status === 403) return '当前会话没有访问该 v2 资源的权限。';
  return `v2 请求失败（HTTP ${status}）。`;
}

function errorFields(body: unknown): { code: string; details: unknown; correlationId: string } {
  if (!isRecord(body)) return { code: 'http_error', details: undefined, correlationId: '' };
  return {
    code: typeof body.code === 'string' ? body.code : 'http_error',
    details: body.details,
    correlationId: typeof body.correlationId === 'string' ? body.correlationId : '',
  };
}

export async function v2Request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  headers.set('cache-control', 'no-store');
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/v2${path}`, {
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
  });
  const body = await readBody(response);
  if (!response.ok) {
    const fields = errorFields(body);
    throw new V2ApiError(messageFrom(body, response.status), response.status, fields.code, fields.details, fields.correlationId);
  }
  return body as T;
}

export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function asItems<T = JsonRecord>(value: unknown, ...keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!isRecord(value)) return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key] as T[];
  }
  if (isRecord(value.data)) return asItems<T>(value.data, ...keys);
  return [];
}

export function objectId(value: unknown): string {
  if (!isRecord(value)) return '';
  const id = value.id ?? value.projectId ?? value.reportId ?? value.workflowId ?? value.runId
    ?? value.findingId ?? value.sourceId ?? value.operationId;
  return id === undefined || id === null ? '' : String(id);
}

export function text(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

const encoded = (value: string) => encodeURIComponent(value);

export const v2 = {
  context: () => v2Request<unknown>('/me/context'),
  attention: () => v2Request<unknown>('/attention'),
  updateAttention: (id: string, body: JsonRecord) => v2Request<unknown>(`/attention/${encoded(id)}`, { method: 'PATCH', body }),

  projects: () => v2Request<unknown>('/projects'),
  createProject: (body: JsonRecord) => v2Request<unknown>('/projects', { method: 'POST', body }),
  project: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}`),
  updateProject: (id: string, body: JsonRecord) => v2Request<unknown>(`/projects/${encoded(id)}`, { method: 'PATCH', body }),
  projectOverview: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}/overview`),
  projectReadiness: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}/readiness`),

  projectSources: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}/sources`),
  createSource: (id: string, body: JsonRecord) => v2Request<unknown>(`/projects/${encoded(id)}/sources`, { method: 'POST', body }),
  probeSource: (id: string, sourceId: string, body: JsonRecord = {}) => v2Request<unknown>(`/projects/${encoded(id)}/sources/${encoded(sourceId)}/probe`, { method: 'POST', body }),

  workflows: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}/workflows`),
  createWorkflow: (id: string, body: JsonRecord) => v2Request<unknown>(`/projects/${encoded(id)}/workflows`, { method: 'POST', body }),
  workflowDraft: (id: string) => v2Request<unknown>(`/workflows/${encoded(id)}/draft`),
  saveWorkflowDraft: (id: string, body: JsonRecord) => v2Request<unknown>(`/workflows/${encoded(id)}/draft`, { method: 'PUT', body }),
  validateWorkflow: (id: string, body: JsonRecord = {}) => v2Request<unknown>(`/workflows/${encoded(id)}/validate`, { method: 'POST', body }),
  publishWorkflow: (id: string, body: JsonRecord = {}) => v2Request<unknown>(`/workflows/${encoded(id)}/publish`, { method: 'POST', body }),
  workflowVersions: (id: string) => v2Request<unknown>(`/workflows/${encoded(id)}/versions`),

  createRun: (versionId: string, body: JsonRecord = {}) => v2Request<unknown>(`/workflow-versions/${encoded(versionId)}/runs`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body,
  }),
  projectRuns: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}/runs`),
  run: (id: string) => v2Request<unknown>(`/runs/${encoded(id)}`),
  runEvents: (id: string) => v2Request<unknown>(`/runs/${encoded(id)}/events`),
  runAction: (id: string, action: string, body: JsonRecord = {}) => v2Request<unknown>(`/runs/${encoded(id)}/actions/${encoded(action)}`, { method: 'POST', body }),

  observations: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}/observations`),
  findings: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}/findings`),
  reviewFinding: (id: string, body: JsonRecord) => v2Request<unknown>(`/findings/${encoded(id)}/reviews`, { method: 'POST', body }),

  reports: (projectId: string) => v2Request<unknown>(`/projects/${encoded(projectId)}/reports`),
  createReportDraft: (id: string, body: JsonRecord = {}) => v2Request<unknown>(`/projects/${encoded(id)}/report-drafts`, { method: 'POST', body }),
  publishReportDraft: (id: string, body: JsonRecord = {}) => v2Request<unknown>(`/report-drafts/${encoded(id)}/publish`, { method: 'POST', body }),
  report: (id: string) => v2Request<unknown>(`/reports/${encoded(id)}`),
  createDelivery: (id: string, body: JsonRecord = {}) => v2Request<unknown>(`/reports/${encoded(id)}/deliveries`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body,
  }),
  deliveries: (id: string) => v2Request<unknown>(`/projects/${encoded(id)}/deliveries`),
  delivery: (id: string) => v2Request<unknown>(`/deliveries/${encoded(id)}`),

  automations: () => v2Request<unknown>('/automations'),
  capabilitiesReadiness: () => v2Request<unknown>('/capabilities/readiness'),
  executionResources: () => v2Request<unknown>('/execution-resources'),
  connections: () => v2Request<unknown>('/connections'),
  members: () => v2Request<unknown>('/workspace/members'),
  developer: () => v2Request<unknown>('/settings/developer'),
  audit: () => v2Request<unknown>('/settings/audit'),
};
