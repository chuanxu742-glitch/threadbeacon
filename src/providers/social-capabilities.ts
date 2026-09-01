// 社媒能力目录与 readiness。
//
// 这里描述的是「当前 provider 能证明的能力」，不是平台名称清单。
// `write` 永远关闭：P0 只允许观察，任何 outbound 行为都必须经过后续审批/风控域。

import type {
  AcquisitionMode,
  Platform,
  ProviderCapability,
  ProviderKind,
} from './types.js';

export type SocialCapabilityTier = 'official' | 'licensed' | 'experimental';

export type SocialReadiness = 'ready' | 'needs-credentials' | 'degraded' | 'experimental';

export type SocialAccountScope = 'none' | 'own-account';

export interface SocialReadCapability {
  readonly enabled: boolean;
  readonly modes: readonly AcquisitionMode[];
  readonly comments: boolean;
}

export interface SocialWriteCapability {
  /** P0 固定为 false；不要把目录当成外发授权。 */
  readonly enabled: false;
  readonly requiresApproval: true;
  readonly reason: 'p0-read-only';
}

/** 单个 provider 在一个平台上的可审计能力描述。 */
export interface SocialCapabilityDescriptor {
  readonly providerId: string;
  readonly platform: Platform;
  readonly tier: SocialCapabilityTier;
  readonly readiness: SocialReadiness;
  readonly readinessReason: string;
  readonly accountScope: SocialAccountScope;
  readonly read: SocialReadCapability;
  readonly write: SocialWriteCapability;
  /** 兼容消费方喜欢布尔字段的场景；与 read/write 同源。 */
  readonly canRead: boolean;
  readonly canWrite: false;
  readonly legalBasis: string;
  readonly providerKind: ProviderKind;
  readonly quota?: ProviderCapability['quota'];
}

/**
 * Worker 可以上报给控制面的安全能力投影。
 *
 * ProviderCapability 的 legalBasis 可能包含部署方的合同/内部说明，且未来
 * provider 还可能携带不适合进入 runtime_json 的扩展字段；heartbeat/report
 * 只需要执行与 readiness 信息，因此这里显式列字段而不是把 descriptor 原样
 * 序列化。这个投影不包含任何 API key、token、Cookie 或用户会话材料。
 */
export interface SocialCapabilityMetadata {
  readonly providerId: string;
  readonly platform: Platform;
  readonly tier: SocialCapabilityTier;
  readonly readiness: SocialReadiness;
  readonly readinessReason: string;
  readonly accountScope: SocialAccountScope;
  readonly read: SocialReadCapability;
  readonly write: SocialWriteCapability;
  readonly canRead: boolean;
  readonly canWrite: false;
  readonly providerKind: ProviderKind;
  readonly quota?: ProviderCapability['quota'];
}

export interface SocialPlatformDirectoryEntry {
  readonly platform: Platform | 'opencli:*';
  readonly displayName: string;
  readonly defaultTier: SocialCapabilityTier;
  readonly defaultReadiness: SocialReadiness;
  /** Platform-level aliases make the static directory directly consumable. */
  readonly tier: SocialCapabilityTier;
  readonly readiness: SocialReadiness;
  readonly accountScope: SocialAccountScope;
  readonly readOnly: true;
  readonly read: SocialReadCapability;
  readonly write: SocialWriteCapability;
  readonly canRead: true;
  readonly canWrite: false;
  readonly notes: string;
}

/**
 * 平台级目录只用于发现与文案；真正的 readiness 要用
 * `buildSocialCapabilityCatalog(registry.capabilities())` 生成。
 */
export const SOCIAL_PLATFORM_DIRECTORY: readonly SocialPlatformDirectoryEntry[] = [
  {
    platform: 'youtube',
    displayName: 'YouTube',
    defaultTier: 'official',
    defaultReadiness: 'needs-credentials',
    tier: 'official',
    readiness: 'needs-credentials',
    accountScope: 'none',
    readOnly: true,
    read: { enabled: true, modes: ['searchAll'], comments: true },
    write: { enabled: false, requiresApproval: true, reason: 'p0-read-only' },
    canRead: true,
    canWrite: false,
    notes: 'Data API v3；search 配额与 key 申请决定可用性。',
  },
  {
    platform: 'reddit',
    displayName: 'Reddit',
    defaultTier: 'official',
    defaultReadiness: 'needs-credentials',
    tier: 'official',
    readiness: 'needs-credentials',
    accountScope: 'none',
    readOnly: true,
    read: { enabled: true, modes: ['searchAll'], comments: true },
    write: { enabled: false, requiresApproval: true, reason: 'p0-read-only' },
    canRead: true,
    canWrite: false,
    notes: '官方 OAuth API；免费档商业使用边界与 Official Data Partner 资格必须单独核验。',
  },
  {
    platform: 'bluesky',
    displayName: 'Bluesky',
    defaultTier: 'official',
    defaultReadiness: 'ready',
    tier: 'official',
    readiness: 'ready',
    accountScope: 'none',
    readOnly: true,
    read: { enabled: true, modes: ['streamLive'], comments: false },
    write: { enabled: false, requiresApproval: true, reason: 'p0-read-only' },
    canRead: true,
    canWrite: false,
    notes: 'Jetstream 是公开实时流；当前不承诺匿名历史检索。',
  },
  {
    platform: 'xiaohongshu',
    displayName: '小红书/XHS',
    defaultTier: 'licensed',
    defaultReadiness: 'needs-credentials',
    tier: 'licensed',
    readiness: 'needs-credentials',
    accountScope: 'none',
    readOnly: true,
    read: { enabled: true, modes: ['searchAll'], comments: true },
    write: { enabled: false, requiresApproval: true, reason: 'p0-read-only' },
    canRead: true,
    canWrite: false,
    notes: 'TikHub 属第三方供应商；Spider_XHS 是用户会话实验适配器，不能互相替代。',
  },
  {
    platform: 'tiktok',
    displayName: 'TikTok',
    defaultTier: 'licensed',
    defaultReadiness: 'needs-credentials',
    tier: 'licensed',
    readiness: 'needs-credentials',
    accountScope: 'none',
    readOnly: true,
    read: { enabled: true, modes: ['searchAll'], comments: true },
    write: { enabled: false, requiresApproval: true, reason: 'p0-read-only' },
    canRead: true,
    canWrite: false,
    notes: 'TikHub 供应商 key/合同并不等同于 TikTok 官方商业授权。',
  },
  {
    platform: 'douyin',
    displayName: '抖音',
    defaultTier: 'licensed',
    defaultReadiness: 'needs-credentials',
    tier: 'licensed',
    readiness: 'needs-credentials',
    accountScope: 'none',
    readOnly: true,
    read: { enabled: true, modes: ['searchAll'], comments: true },
    write: { enabled: false, requiresApproval: true, reason: 'p0-read-only' },
    canRead: true,
    canWrite: false,
    notes: '只登记供应商适配器的读取能力，不宣称平台官方授权。',
  },
  {
    platform: 'opencli:*',
    displayName: 'OpenCLI 动态站点',
    defaultTier: 'experimental',
    defaultReadiness: 'experimental',
    tier: 'experimental',
    readiness: 'experimental',
    accountScope: 'none',
    readOnly: true,
    read: { enabled: true, modes: ['searchAll'], comments: false },
    write: { enabled: false, requiresApproval: true, reason: 'p0-read-only' },
    canRead: true,
    canWrite: false,
    notes: '逐站点读取目录；浏览器命令需受管 Profile/CDP，动态目录不构成平台授权。',
  },
] as const;

/** 保留一个更短的别名，便于 API/测试按“能力目录”查找。 */
export const SOCIAL_CAPABILITY_CATALOG = SOCIAL_PLATFORM_DIRECTORY;

export function capabilityTierFor(provider: Pick<ProviderCapability, 'platform' | 'kind'>): SocialCapabilityTier {
  // OpenCLI 的动态适配器不能因为下游站点名称而继承平台官方等级。
  if (provider.platform.startsWith('opencli:')) return 'experimental';
  if (provider.kind === 'official-api' || provider.kind === 'open-protocol') return 'official';
  if (provider.kind === 'licensed-vendor') return 'licensed';
  return 'experimental';
}

export function readinessFor(provider: Pick<ProviderCapability, 'platform' | 'kind' | 'modes'>): SocialReadiness {
  if (provider.platform.startsWith('opencli:')) return 'experimental';
  if (provider.kind === 'open-protocol' && provider.modes.length > 0) return 'ready';
  if (provider.kind === 'official-api' || provider.kind === 'licensed-vendor') {
    return 'needs-credentials';
  }
  return 'needs-credentials';
}

function readinessReason(capability: ProviderCapability, readiness: SocialReadiness): string {
  if (capability.platform.startsWith('opencli:')) {
    return '动态外部只读适配器；需逐站点检查命令目录、Profile/CDP、登录态与站点条款';
  }
  if (capability.kind === 'open-protocol') {
    return capability.modes.includes('streamLive')
      ? '公开协议实时流可用；历史覆盖与持续订阅由运行时负责'
      : '公开协议读取；仍需按端点与站点政策核验覆盖范围';
  }
  if (capability.kind === 'official-api') {
    return '需要平台签发的应用凭据、配额/计费配置与当前条款核验';
  }
  if (capability.kind === 'licensed-vendor') {
    return '需要供应商 key/合同；licensed vendor 不等同于目标平台官方商业授权';
  }
  return readiness === 'needs-credentials'
    ? '需要明确的自有账号授权；登录态与数据主体范围必须留在 Worker 审计'
    : '实验能力，需逐次验收';
}

/**
 * 将现有 ProviderCapability 转为社媒域可消费的能力目录。
 * 不访问网络，也不把“已注册”误报成“真实凭据已就绪”。
 */
export function buildSocialCapabilityCatalog(
  capabilities: readonly ProviderCapability[],
): SocialCapabilityDescriptor[] {
  return capabilities
    .map((capability): SocialCapabilityDescriptor => {
      const tier = capabilityTierFor(capability);
      const readiness = readinessFor(capability);
      const canRead = capability.modes.length > 0;
      return {
        providerId: capability.id,
        platform: capability.platform,
        tier,
        readiness,
        readinessReason: readinessReason(capability, readiness),
        accountScope: capability.kind === 'user-authorized' ? 'own-account' : 'none',
        read: {
          enabled: canRead,
          modes: capability.modes,
          comments: capability.canFetchComments,
        },
        write: { enabled: false, requiresApproval: true, reason: 'p0-read-only' },
        canRead,
        canWrite: false,
        legalBasis: capability.legalBasis,
        providerKind: capability.kind,
        ...(capability.quota ? { quota: capability.quota } : {}),
      };
    })
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.providerId.localeCompare(b.providerId));
}

/**
 * 去掉 provider 证明文字，只保留可安全进入 heartbeat/report metadata 的字段。
 * 返回新对象，调用方无法通过修改上报值反向影响 registry 的能力描述。
 */
export function safeSocialCapabilityMetadata(
  descriptors: readonly SocialCapabilityDescriptor[],
): SocialCapabilityMetadata[] {
  return descriptors.map((descriptor): SocialCapabilityMetadata => ({
    providerId: descriptor.providerId,
    platform: descriptor.platform,
    tier: descriptor.tier,
    readiness: descriptor.readiness,
    readinessReason: descriptor.readinessReason,
    accountScope: descriptor.accountScope,
    read: {
      enabled: descriptor.read.enabled,
      modes: [...descriptor.read.modes],
      comments: descriptor.read.comments,
    },
    write: {
      enabled: false,
      requiresApproval: true,
      reason: 'p0-read-only',
    },
    canRead: descriptor.canRead,
    canWrite: false,
    providerKind: descriptor.providerKind,
    ...(descriptor.quota ? {
      // 配额的可计算字段可安全用于调度；不把自由文本 note 带进 runtime_json，
      // 避免未来 provider 把合同/凭据说明误放进能力 metadata。
      quota: {
        unit: descriptor.quota.unit,
        ...(descriptor.quota.perDay === undefined ? {} : { perDay: descriptor.quota.perDay }),
        ...(descriptor.quota.costPerCall === undefined ? {} : { costPerCall: descriptor.quota.costPerCall }),
      },
    } : {}),
  }));
}

/** 语义化别名，避免调用方把 provider catalog 与 platform directory 混淆。 */
export const socialCapabilityCatalog = buildSocialCapabilityCatalog;
