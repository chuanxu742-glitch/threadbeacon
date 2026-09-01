import { afterEach, describe, expect, it, vi } from 'vitest';
import { v2Request } from '../apps/control-plane/app/api/v2.js';

describe('v2Request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses a successful JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
    await expect(v2Request('/projects')).resolves.toEqual({ ok: true });
  });

  it('turns an empty unauthorized response into an actionable v2 error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(v2Request('/projects')).rejects.toMatchObject({
      status: 401,
      code: 'http_error',
      message: '当前会话没有访问该 v2 资源的权限。',
    });
  });

  it('preserves structured errors and correlation ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      code: 'WORKFLOW_BLOCKED',
      message: '工作流尚未就绪',
      details: { blockers: 2 },
      correlationId: 'request-42',
    }, { status: 409 })));
    await expect(v2Request('/workflows/w1/publish')).rejects.toMatchObject({
      status: 409,
      code: 'WORKFLOW_BLOCKED',
      message: '工作流尚未就绪',
      details: { blockers: 2 },
      correlationId: 'request-42',
    });
  });
});
