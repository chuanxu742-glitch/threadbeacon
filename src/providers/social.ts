// 平台无关的社媒领域归一化。
//
// Provider 只负责把平台响应解析为 RawObservation/SourceItem；本文件负责把它们
// 映射成稳定的社媒域 envelope。它不做主题推断、情绪推断或 outbound 行为。

import { createHash } from 'node:crypto';
import { buildSourceItem } from './item.js';
import {
  capabilityTierFor,
  type SocialCapabilityTier,
} from './social-capabilities.js';
import type {
  AcquisitionMode,
  AuthMode,
  ItemType,
  Platform,
  ProviderKind,
  Provenance,
  RawObservation,
  SourceItem,
  TextBundle,
} from './types.js';
import type { RobotsStatus } from './types.js';

export type SocialContentType = ItemType;

export interface SocialAuthor {
  readonly id?: string;
  readonly handle?: string;
  readonly name?: string;
  readonly url?: string;
}

export interface SocialEngagementSnapshot {
  readonly likes?: number;
  readonly comments?: number;
  readonly shares?: number;
  readonly views?: number;
}

export interface SocialSentimentPending {
  readonly status: 'pending';
  readonly label?: never;
  readonly score?: never;
  readonly confidence?: never;
}

export interface SocialSourceLineage {
  readonly providerId: string;
  readonly sourceId: string;
  readonly observationId: string;
  readonly legalBasis: string;
  readonly capabilityTier: SocialCapabilityTier;
  readonly platform: Platform;
  readonly providerKind: ProviderKind;
  readonly mode: AcquisitionMode;
  readonly auth: AuthMode;
  readonly robots: RobotsStatus;
  readonly fetchedAt: string;
}

/**
 * v1 社媒观察 envelope。
 *
 * `topics` 与 `tags` 都只包含上游明确给出的标签（如 provider raw.hashtags），
 * 不把文本关键词冒充模型主题；`sentiment` 在分析服务完成前只有 pending。
 */
export interface NormalizedSocialObservation {
  readonly schema: 'threadbeacon.social.observation.v1';
  readonly observationId: string;
  readonly platform: Platform;
  readonly contentType: SocialContentType;
  readonly externalId: string;
  readonly canonicalUrl?: string;
  readonly author?: SocialAuthor;
  readonly text: string;
  readonly title?: string;
  readonly publishedAt: string;
  /** 观测/采集时间，不把发布时间重复当作采集时间。 */
  readonly observedAt: string;
  readonly engagement?: SocialEngagementSnapshot;
  readonly topics: readonly string[];
  readonly tags: readonly string[];
  readonly conversationId?: string;
  readonly parentId?: string;
  readonly sentiment: SocialSentimentPending;
  readonly contentHash: string;
  readonly source: SocialSourceLineage;
}

export interface SocialNormalizationOptions {
  /** 来源连接/登记 ID；缺省时由 provider+platform 形成稳定值。 */
  readonly sourceId?: string;
  /** 上游已经分配的观察 ID；缺省时由稳定内容身份派生。 */
  readonly observationId?: string;
}

/** 当前已经有可执行 provider 的社媒平台族；OpenCLI 是逐站点动态平台。 */
const SUPPORTED_SOCIAL_PLATFORMS = new Set([
  'youtube',
  'reddit',
  'bluesky',
  'xiaohongshu',
  'tiktok',
  'douyin',
]);

export function isSocialPlatform(platform: unknown): platform is Platform {
  return typeof platform === 'string'
    && (SUPPORTED_SOCIAL_PLATFORMS.has(platform) || platform.startsWith('opencli:'));
}

const TRACKING_QUERY_KEYS = new Set([
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'xsec_source',
  // Spider_XHS 的 xsec token 是临时访问参数，不是内容身份，不能进入 lineage URL。
  'xsec_token',
  // 其他 provider/适配器有时把访问凭据放在 URL query；它们也不属于内容身份。
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'authorization',
  'cookie',
  'session',
  'session_id',
  'sessionid',
  'sid',
  'csrf',
  'csrf_token',
  'signature',
]);

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstText(record: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = textValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function iso(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field}: 无法解析的时间值 ${value}`);
  return date.toISOString();
}

function digest(...parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u001f'), 'utf8').digest('hex');
}

/**
 * 去除明确的追踪/临时访问/凭据参数，并排序剩余 query；不删除可能影响内容
 * 身份的普通参数。
 */
export function canonicalizeSocialUrl(value: string | undefined): string | undefined {
  const input = textValue(value);
  if (!input) return undefined;
  try {
    const url = new URL(input);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.has(key.toLowerCase()) || isSensitiveOutputKey(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const rendered = url.toString();
    if (url.pathname !== '/' && rendered.endsWith('/')) return rendered.slice(0, -1);
    return rendered;
  } catch {
    // 保留非 URL 的 provider locator，但仍去掉两端空白；不伪造 URL。
    return input;
  }
}

function normalizedOutputKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/** 输出边界禁止把会话、签名和供应商凭据随 raw 带入控制面。 */
function isSensitiveOutputKey(key: string): boolean {
  const normalized = normalizedOutputKey(key);
  return normalized === 'xsec_token'
    || normalized === 'xsec_source'
    || normalized.includes('xsec_')
    || normalized === 'cookie'
    || normalized === 'cookies'
    || normalized.includes('cookie')
    || normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized === 'authorization'
    || normalized.startsWith('authorization_')
    || normalized === 'api_key'
    || normalized.endsWith('_api_key')
    || normalized === 'session'
    || normalized === 'session_id'
    || normalized === 'session_key'
    || normalized === 'session_cookie'
    || normalized === 'session_token'
    || normalized === 'sessionid'
    || normalized === 'sid'
    || normalized === 'csrf'
    || normalized === 'signature'
    || normalized.endsWith('_signature');
}

function isUrlOutputKey(key: string | undefined): boolean {
  if (!key) return false;
  const normalized = normalizedOutputKey(key);
  return normalized === 'url'
    || normalized === 'uri'
    || normalized.endsWith('_url')
    || normalized.endsWith('_uri')
    || normalized.endsWith('_link');
}

/**
 * 递归复制并清理 provider raw。只对 URL 命名字段做 canonicalize，避免把普通
 * 文本当 URL 改写；所有敏感字段直接丢弃，不用字符串替换留下半截凭据。
 */
function sanitizeOutputValue(value: unknown, key: string | undefined, canonicalizeUrls: boolean): unknown {
  if (key && isSensitiveOutputKey(key)) return undefined;
  if (typeof value === 'string' && canonicalizeUrls && isUrlOutputKey(key)) {
    return canonicalizeSocialUrl(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeOutputValue(entry, undefined, canonicalizeUrls))
      .filter((entry): entry is unknown => entry !== undefined);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      const safe = sanitizeOutputValue(childValue, childKey, canonicalizeUrls);
      if (safe !== undefined) output[childKey] = safe;
    }
    return output;
  }
  return value;
}

/**
 * 复制 SourceItem 供 Worker 回传；provider 内部的 item/raw 不被改写。
 * 社媒 URL 同时 canonicalize，防止 Java records.source_url 留下 xsec 参数。
 */
export function sanitizeWorkerOutputItem(item: SourceItem): SourceItem {
  const safe = sanitizeOutputValue(item, undefined, isSocialPlatform(item.platform));
  return safe && typeof safe === 'object' && !Array.isArray(safe) ? safe as SourceItem : item;
}

export interface SocialObservationOutputItem extends SourceItem {
  /** Java JobService 将整个 item 写入 observations.payload_json。 */
  readonly socialObservation: NormalizedSocialObservation;
}

function sourceItemValue(value: unknown): value is SourceItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item['text'] === 'string'
    && typeof item['postedAt'] === 'string'
    && typeof item['platform'] === 'string'
    && typeof item['itemType'] === 'string';
}

function provenanceValue(value: unknown): value is Provenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const provenance = value as Record<string, unknown>;
  return typeof provenance['providerId'] === 'string'
    && typeof provenance['platform'] === 'string'
    && typeof provenance['kind'] === 'string'
    && typeof provenance['mode'] === 'string'
    && typeof provenance['fetchedAt'] === 'string'
    && typeof provenance['legalBasis'] === 'string'
    && typeof provenance['robots'] === 'string'
    && typeof provenance['auth'] === 'string';
}

function rawRecord(item: SourceItem): Record<string, unknown> | undefined {
  return item.raw && typeof item.raw === 'object' ? item.raw : undefined;
}

function encodeProfilePart(value: string): string {
  return encodeURIComponent(value.replace(/^@/, ''));
}

function derivedAuthorUrl(platform: Platform, id: string | undefined, handle: string | undefined): string | undefined {
  const account = handle || id;
  if (!account || account === '[deleted]') return undefined;
  const p = platform.startsWith('opencli:') ? 'opencli' : platform;
  switch (p) {
    case 'youtube':
      return id ? `https://www.youtube.com/channel/${encodeProfilePart(id)}` : undefined;
    case 'reddit':
      return `https://www.reddit.com/user/${encodeProfilePart(account)}`;
    case 'bluesky':
      return `https://bsky.app/profile/${encodeProfilePart(account)}`;
    case 'xiaohongshu':
      return id ? `https://www.xiaohongshu.com/user/profile/${encodeProfilePart(id)}` : undefined;
    case 'tiktok':
      return `https://www.tiktok.com/@${encodeProfilePart(account)}`;
    case 'douyin':
      return id ? `https://www.douyin.com/user/${encodeProfilePart(id)}` : undefined;
    default:
      return undefined;
  }
}

function normalizeAuthor(item: SourceItem): SocialAuthor | undefined {
  const raw = rawRecord(item);
  const id = textValue(item.authorId);
  const rawHandle = firstText(raw, ['authorHandle', 'author_handle', 'handle', 'username', 'uniqueId']);
  const rawName = firstText(raw, [
    'authorName',
    'author_name',
    'displayName',
    'display_name',
    'authorDisplayName',
  ]);
  const author = textValue(item.author);
  let handle = rawHandle;
  let name = rawName;
  if (item.platform === 'reddit' || item.platform === 'bluesky') {
    handle ??= author;
  } else {
    name ??= author;
    // TikTok 的现有 adapter 把 uniqueId 放在 authorId，保留为可定位 handle。
    if (item.platform === 'tiktok' && !handle && id) handle = id;
  }
  const url = canonicalizeSocialUrl(
    firstText(raw, ['authorUrl', 'author_url', 'profileUrl', 'profile_url', 'userUrl', 'user_url'])
      ?? derivedAuthorUrl(item.platform, id, handle),
  );
  if (!id && !handle && !name && !url) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(handle ? { handle } : {}),
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
  };
}

function finiteMetric(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeEngagement(metrics: SourceItem['metrics']): SocialEngagementSnapshot | undefined {
  if (!metrics) return undefined;
  const engagement = {
    ...(finiteMetric(metrics.likes) !== undefined ? { likes: finiteMetric(metrics.likes) } : {}),
    ...(finiteMetric(metrics.comments) !== undefined ? { comments: finiteMetric(metrics.comments) } : {}),
    ...(finiteMetric(metrics.shares) !== undefined ? { shares: finiteMetric(metrics.shares) } : {}),
    ...(finiteMetric(metrics.views) !== undefined ? { views: finiteMetric(metrics.views) } : {}),
  };
  return Object.keys(engagement).length ? engagement : undefined;
}

function tagsFromValue(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/[\s,，、]+/u)
      .map((part) => part.replace(/^#+/, '').trim().replace(/[。！？!?，,;；]+$/u, ''))
      .filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap(tagsFromValue);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return tagsFromValue(
      object['label']
        ?? object['name']
        ?? object['tag']
        ?? object['hashtag']
        ?? object['cha_name']
        ?? object['text'],
    );
  }
  return [];
}

function explicitTags(item: SourceItem): string[] {
  const raw = rawRecord(item);
  const values = raw
    ? [raw['hashtags'], raw['tags'], raw['topicTags'], raw['topic_tags']].flatMap(tagsFromValue)
    : [];
  // A literal #token in a post is an explicit platform tag, not model inference.
  const textTags = item.text.match(/#[\p{L}\p{N}_-]{1,100}/gu) ?? [];
  values.push(...textTags.map((tag) => tag.replace(/^#+/u, '')));
  return [...new Set(values.map((tag) => tag.normalize('NFC')).filter(Boolean))];
}

function normalizeConversationValue(platform: Platform, value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Reddit returns fullname references for some comment-tree fields; the provider
  // already strips these for parentId, and the domain keeps both refs consistent.
  return platform === 'reddit' ? value.replace(/^t[13]_/, '') : value;
}

function conversationRefs(item: SourceItem, externalId: string): {
  conversationId?: string;
  parentId?: string;
} {
  const raw = rawRecord(item);
  const parentId = normalizeConversationValue(item.platform, textValue(item.parentId));
  const rawConversation = firstText(raw, [
    'conversationId',
    'conversation_id',
    'threadId',
    'thread_id',
    'replyRoot',
    'rootUri',
    'root_uri',
    'linkId',
  ]);
  const conversationId = normalizeConversationValue(item.platform, rawConversation)
    ?? (item.itemType === 'comment' ? parentId : externalId);
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(parentId ? { parentId } : {}),
  };
}

function itemFrom(input: RawObservation | SourceItem): SourceItem {
  return 'postedAt' in input && 'timeBucket' in input ? input : buildSourceItem(input);
}

/** 将单条 RawObservation/SourceItem 映射为平台无关的社媒观察。 */
export function normalizeSocialObservation(
  input: RawObservation | SourceItem,
  provenance: Provenance,
  options: SocialNormalizationOptions = {},
): NormalizedSocialObservation {
  const item = itemFrom(input);
  const platform = item.platform;
  const contentType = item.itemType;
  const publishedAt = iso(item.postedAt, 'publishedAt');
  const observedAt = iso(provenance.fetchedAt, 'observedAt');
  const canonicalUrl = canonicalizeSocialUrl(item.url);
  const externalId = textValue(item.id)
    ?? canonicalUrl
    ?? `derived_${digest(platform, contentType, item.text, publishedAt)}`;
  const sourceId = options.sourceId ?? `${provenance.providerId}:${platform}`;
  const contentHash = digest(contentType, externalId, item.title ?? '', item.text, publishedAt);
  const observationId = options.observationId ?? `social_obs_${digest(sourceId, externalId, contentHash)}`;
  const tags = explicitTags(item);
  const refs = conversationRefs(item, externalId);
  const author = normalizeAuthor(item);
  const engagement = normalizeEngagement(item.metrics);

  return {
    schema: 'threadbeacon.social.observation.v1',
    observationId,
    platform,
    contentType,
    externalId,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(author ? { author } : {}),
    text: item.text,
    ...(item.title ? { title: item.title } : {}),
    publishedAt,
    observedAt,
    ...(engagement ? { engagement } : {}),
    topics: tags,
    tags,
    ...(refs.conversationId ? { conversationId: refs.conversationId } : {}),
    ...(refs.parentId ? { parentId: refs.parentId } : {}),
    sentiment: { status: 'pending' },
    contentHash,
    source: {
      providerId: provenance.providerId,
      sourceId,
      observationId,
      legalBasis: provenance.legalBasis,
      capabilityTier: capabilityTierFor(provenance),
      platform: provenance.platform,
      providerKind: provenance.kind,
      mode: provenance.mode,
      auth: provenance.auth,
      robots: provenance.robots,
      fetchedAt: observedAt,
    },
  };
}

/** 将 provider 的 TextBundle 中所有帖子/评论批量映射为同一 envelope。 */
export function normalizeSocialBundle(
  bundle: TextBundle,
  options: SocialNormalizationOptions = {},
): NormalizedSocialObservation[] {
  return bundle.items.map((item, index) => normalizeSocialObservation(
    item,
    bundle.provenance,
    options.observationId
      ? { ...options, observationId: bundle.items.length === 1 ? options.observationId : `${options.observationId}:${index}` }
      : options,
  ));
}

/**
 * Worker 回传前的生产边界：保留旧 SourceItem 字段，同时把 envelope 直接挂到
 * 同一条 item 上。这样 JobService.persistRecord 写入 payload_json 时每条观察
 * 都有可消费的标准结构，而不是只在 report 顶层放一个下游不会读取的数组。
 * 非社媒 item 仍原样保留（仅递归清理 raw 中的敏感字段）。
 */
export function attachSocialObservationEnvelope(
  report: Record<string, unknown>,
  options: SocialNormalizationOptions = {},
): Record<string, unknown> {
  const values = Array.isArray(report['items']) ? report['items'] : [];
  const provenance = provenanceValue(report['provenance']) ? report['provenance'] : undefined;
  const sourceItems = values.map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: SourceItem; index: number } => sourceItemValue(entry.value));
  const socialEntries = sourceItems.filter((entry) => isSocialPlatform(entry.value.platform));
  const envelopes = provenance && socialEntries.length > 0
    ? normalizeSocialBundle({
      items: socialEntries.map((entry) => entry.value),
      provenance,
    }, options)
    : [];
  const byIndex = new Map<number, NormalizedSocialObservation>();
  socialEntries.forEach((entry, index) => {
    const envelope = envelopes[index];
    if (envelope) byIndex.set(entry.index, envelope);
  });

  const items = values.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const item = value as Record<string, unknown>;
    const safe = sanitizeOutputValue(item, undefined, isSocialPlatform(item['platform']));
    const output = safe && typeof safe === 'object' && !Array.isArray(safe)
      ? safe as Record<string, unknown>
      : item;
    const envelope = byIndex.get(index);
    return envelope ? { ...output, socialObservation: envelope } : output;
  });
  return { ...report, items };
}

/** 兼容调用方偏好的复数命名。 */
export const normalizeSocialObservations = normalizeSocialBundle;
