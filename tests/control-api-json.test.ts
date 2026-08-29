import { describe, expect, it } from 'vitest';
import { apiJson } from '../apps/control-plane/app/components/api-json.js';

describe('apiJson', () => {
  it('parses a successful JSON response', async () => {
    await expect(apiJson(Response.json({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it('turns an empty unauthorized response into a login message', async () => {
    const response = new Response(null, { status: 401 });
    await expect(apiJson(response)).rejects.toThrow('需要登录或登录已失效');
  });

  it('reports malformed non-authentication responses clearly', async () => {
    const response = new Response('<html>bad gateway</html>', { status: 502 });
    await expect(apiJson(response)).rejects.toThrow('无法解析的响应（HTTP 502）');
  });
});
