function responseError(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('error' in body)) return undefined;
  const value = (body as { error?: unknown }).error;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Parse an API response while preserving useful authentication and protocol errors. */
export async function apiJson(response: Response): Promise<unknown> {
  const text = await response.text();
  const authenticationError = response.status === 401
    ? '需要登录或登录已失效，请刷新页面后重新登录。'
    : response.status === 403
      ? '当前账号没有执行此操作的权限。'
      : undefined;

  if (!text.trim()) {
    if (authenticationError) throw new Error(authenticationError);
    return {};
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    if (authenticationError) throw new Error(authenticationError);
    throw new Error(`控制平面返回了无法解析的响应（HTTP ${response.status}）。`);
  }

  if (authenticationError) throw new Error(responseError(body) ?? authenticationError);
  return body;
}
