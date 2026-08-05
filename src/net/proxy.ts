// 进程级代理配置。
//
// 为什么放在进程级而不是 PoliteHttpClient 里：
// 需要走代理的不只有数据源。若网络屏蔽了 bsky/reddit/googleapis，
// 那么 api.anthropic.com 与 api.openai.com 通常同样不可达，
// 而那两个走的是各自 SDK 的 fetch，不经过我们的 HTTP 客户端。
// 设置全局 dispatcher 能一次覆盖全部出站请求。
//
// 这是应用层决策，因此由入口（CLI）显式调用，库代码不擅自改全局状态。

let applied: string | undefined;

/**
 * 按环境变量配置全局代理，返回实际生效的地址（未配置则返回 undefined）。
 * 重复调用是幂等的。
 */
export async function configureProxyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const url = env['HTTPS_PROXY'] ?? env['HTTP_PROXY'];
  if (!url || applied === url) return applied;

  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new ProxyAgent(url));
  applied = url;
  return url;
}

export function activeProxy(): string | undefined {
  return applied;
}
