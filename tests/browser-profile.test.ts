import { describe, expect, it } from 'vitest';
import {
  browserProfileKind,
  browserProfileName,
  isFreshAnonymousAttestation,
  unavailableBrowserAttestation,
} from '../src/browser-profile.js';

describe('browser profile attestation', () => {
  it('separates the configured profile name from its security kind', () => {
    const env = { THREADBEACON_BROWSER_PROFILE: 'geo-clean-01', THREADBEACON_BROWSER_PROFILE_KIND: 'anonymous' };
    expect(browserProfileName(env)).toBe('geo-clean-01');
    expect(browserProfileKind(env)).toBe('anonymous');
    expect(browserProfileKind({ THREADBEACON_BROWSER_PROFILE: 'anonymous' })).toBe('anonymous');
    expect(() => browserProfileKind({ THREADBEACON_BROWSER_PROFILE_KIND: 'shared' })).toThrow('只允许');
  });

  it('accepts only fresh, verified and cookie-free anonymous proof', () => {
    const fresh = {
      schemaVersion: 1, profileName: 'geo-clean-01', profileKind: 'anonymous', verified: true,
      cookieCount: 0, targetCount: 1, browserFingerprint: 'abc',
      checkedAt: '2026-08-28T00:00:00.000Z', expiresAt: '2026-08-28T00:01:15.000Z',
    };
    expect(isFreshAnonymousAttestation(fresh, Date.parse('2026-08-28T00:00:30.000Z'))).toBe(true);
    expect(isFreshAnonymousAttestation({ ...fresh, cookieCount: 1 }, Date.parse('2026-08-28T00:00:30.000Z'))).toBe(false);
    expect(isFreshAnonymousAttestation(fresh, Date.parse('2026-08-28T00:02:00.000Z'))).toBe(false);
    expect(unavailableBrowserAttestation('anonymous', new Error('offline')).verified).toBe(false);
  });
});
