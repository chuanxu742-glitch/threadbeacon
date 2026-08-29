import { describe, expect, it, vi } from 'vitest';
import {
  executeOfficialSiteGeoReport,
  geoCapabilityReady,
  OFFICIAL_SITE_CAPABILITY,
  parseGeoJobOptions,
  type OfficialSiteObservation,
} from '../src/geo/official-site.js';

const observation: OfficialSiteObservation = {
  capabilityId: 'official-site.observe',
  capabilityVersion: '1.0.0',
  outputSchemaVersion: '1',
  requestedUrl: 'https://example.com/',
  finalUrl: 'https://example.com/',
  accessState: 'accessible',
  accessMarkers: [],
  personalizationDetected: false,
  personalizationMarkers: [],
  title: 'Example',
  description: 'Public example site',
  bodyText: 'Example Domain',
  bodyTextLength: 14,
  bodyTextTruncated: false,
  bodyTextSha256: 'b'.repeat(64),
  domLength: 100,
  domSha256: 'd'.repeat(64),
  observedAt: '2026-08-28T00:00:00.000Z',
};

describe('managed GEO official-site capability', () => {
  it('keeps the versioned capability identity fixed', () => {
    expect(parseGeoJobOptions({ geo: {} })).toEqual({
      capabilityId: 'official-site.observe',
      capabilityVersion: '1.0.0',
      outputSchemaVersion: '1',
    });
    expect(() => parseGeoJobOptions({ geo: { capabilityId: 'chat-ai.capture' } })).toThrow('不支持的 GEO 能力');
    expect(() => parseGeoJobOptions({ geo: { capabilityVersion: '2.0.0' } })).toThrow('不支持的 GEO 能力版本');
  });

  it('advertises GEO only from a browser-ready anonymous worker', () => {
    const browserCatalog = [{ site: 'web', name: 'open', command: 'web open', access: 'read' as const, browser: true }];
    expect(geoCapabilityReady(browserCatalog, { OPENCLI_CDP_ENDPOINT: 'http://127.0.0.1:9222', THREADBEACON_BROWSER_PROFILE: 'anonymous' })).toBe(true);
    expect(geoCapabilityReady(browserCatalog, { OPENCLI_CDP_ENDPOINT: 'http://127.0.0.1:9222', THREADBEACON_BROWSER_PROFILE: 'default' })).toBe(false);
    expect(geoCapabilityReady([], { OPENCLI_CDP_ENDPOINT: 'http://127.0.0.1:9222', THREADBEACON_BROWSER_PROFILE: 'anonymous' })).toBe(false);
  });

  it('turns an observation into the existing report and provenance contract', async () => {
    const observer = vi.fn(async () => observation);
    const report = await executeOfficialSiteGeoReport('https://example.com', { geo: {} }, observer, {});
    expect(observer).toHaveBeenCalledWith('https://example.com', {});
    expect(report.capability).toEqual(OFFICIAL_SITE_CAPABILITY);
    expect(report.provenance).toMatchObject({ providerId: 'official-site.observe', platform: 'geo', auth: 'anonymous', robots: 'checked' });
    expect(report.items[0]).toMatchObject({ id: 'd'.repeat(64), platform: 'geo', title: 'Example', url: 'https://example.com/' });
    expect(report.geoAcquisition.domLength).toBe(100);
    expect(report.geoTrace.events.map((event) => event.type)).toEqual([
      'validation.started', 'robots.checked', 'browser.observed', 'snapshot.hashed',
    ]);
  });

  it('fails closed on personalized or blocked pages', async () => {
    await expect(executeOfficialSiteGeoReport('https://example.com', {}, async () => ({ ...observation, personalizationDetected: true, accessState: 'personalized' }))).rejects.toThrow('登录身份');
    await expect(executeOfficialSiteGeoReport('https://example.com', {}, async () => ({ ...observation, accessState: 'login-wall' }))).rejects.toThrow('不可公开观测');
  });
});
