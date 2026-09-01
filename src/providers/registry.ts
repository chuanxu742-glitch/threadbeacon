// Provider 注册表。
//
// 替代上游的 DataSourceFactory —— 后者把「平台」和「供应商」混进同一个枚举
// （'tikhub' 与 'youtube' 并列，且 getSourceDisplayName('tikhub') 返回 'douyin API'），
// 导致换供应商时没有接缝。这里按 (platform, kind) 二维索引。

import type {
  AcquisitionMode,
  IDataProvider,
  Platform,
  ProviderCapability,
  ProviderKind,
} from './types.js';
import { buildSocialCapabilityCatalog, type SocialCapabilityDescriptor } from './social-capabilities.js';

const keyOf = (platform: Platform, kind: ProviderKind): string => `${platform}:${kind}`;

export class ProviderRegistry {
  private readonly byKey = new Map<string, IDataProvider>();

  register(provider: IDataProvider): this {
    const { platform, kind, id } = provider.capability;
    const key = keyOf(platform, kind);
    const existing = this.byKey.get(key);
    if (existing) {
      throw new Error(
        `${key} 已被 provider "${existing.capability.id}" 占用，无法再注册 "${id}"。`,
      );
    }
    this.byKey.set(key, provider);
    return this;
  }

  get(platform: Platform, kind: ProviderKind): IDataProvider | undefined {
    return this.byKey.get(keyOf(platform, kind));
  }

  /** 某平台下所有已注册的 provider，按 kind 的合规优先级排序。 */
  forPlatform(platform: Platform): IDataProvider[] {
    const order: readonly ProviderKind[] = [
      'open-protocol',
      'official-api',
      'licensed-vendor',
      'user-authorized',
    ];
    return order
      .map((kind) => this.byKey.get(keyOf(platform, kind)))
      .filter((p): p is IDataProvider => p !== undefined);
  }

  /**
   * 挑选能满足指定获取模式的 provider，优先级同上。
   * 前端应据此渲染可选项，而不是让用户选完再在运行时报错。
   */
  resolve(platform: Platform, mode: AcquisitionMode): IDataProvider | undefined {
    return this.forPlatform(platform).find((p) => p.capability.modes.includes(mode));
  }

  capabilities(): ProviderCapability[] {
    return [...this.byKey.values()].map((p) => p.capability);
  }

  /** 将已注册 provider 的能力投影为社媒域 readiness；不做网络探测或凭据判断。 */
  socialCapabilities(): SocialCapabilityDescriptor[] {
    return buildSocialCapabilityCatalog(this.capabilities());
  }

  /** 支持指定模式的平台清单。用于 UI 禁用不支持的组合。 */
  platformsSupporting(mode: AcquisitionMode): Platform[] {
    const seen = new Set<Platform>();
    for (const p of this.byKey.values()) {
      if (p.capability.modes.includes(mode)) seen.add(p.capability.platform);
    }
    return [...seen].sort();
  }
}
