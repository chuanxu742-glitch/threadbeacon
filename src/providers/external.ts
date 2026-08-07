// 外部工具端口。
//
// 有些数据源没有可用的 HTTP 接口，只能通过一个独立的外部程序取数
// （典型是需要登录态、且实现只存在于另一种语言里的工具）。
// 这类 provider 不经过 PoliteHttpClient，但仍然要如实声明凭据档位，
// 否则 provenance 里会出现「用了登录态却标成 anonymous」这种失真记录。
//
// 这个端口的 getJson / postForm 一律抛错 —— 它存在的意义是携带 authMode，
// 而不是发请求。真被调用说明有人走错了路径，早失败好过静默发出请求。

import type { AuthMode, HttpPort } from './http.js';

export class ExternalToolTransportError extends Error {
  constructor(method: string) {
    super(
      `ExternalToolPort.${method} 不应被调用：该 provider 通过外部程序取数，` +
        `不走 caiji 的 HTTP 层。若你需要在此发 HTTP 请求，请改用 PoliteHttpClient。`,
    );
    this.name = 'ExternalToolTransportError';
  }
}

/**
 * 只承载 authMode 的占位端口。
 *
 * 默认 'user-session' —— 会走到外部工具这条路，多半正是因为该数据源
 * 需要登录态。要用别的档位请显式传。
 */
export class ExternalToolPort implements HttpPort {
  readonly authMode: AuthMode;

  constructor(authMode: AuthMode = 'user-session') {
    this.authMode = authMode;
  }

  async getJson<T>(): Promise<T> {
    throw new ExternalToolTransportError('getJson');
  }

  async postForm<T>(): Promise<T> {
    throw new ExternalToolTransportError('postForm');
  }
}
