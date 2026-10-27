import { describe, expect, it } from 'vitest';
import { configuredAllowedOrigins, isLocalSameOrigin } from '../../src/origin-validation.js';

describe('PDLC product origin at every HTTP guard', () => {
  const env = {
    OD_PDLC_AUTH_ISSUER: 'https://auth.example', OD_PDLC_CLIENT_ID: 'open-design',
    OD_PDLC_PUBLIC_ORIGIN: 'https://studio.example', OD_PDLC_HOST_ORIGIN: 'https://portal.example',
    OD_ALLOWED_ORIGINS: 'https://existing.example',
  };
  it('uses one canonical product origin through a proxy without allowing the parent or a neighbor', () => {
    expect(configuredAllowedOrigins(env)).toEqual(['https://existing.example', 'https://studio.example']);
    for (const [origin, allowed] of [['https://studio.example', true], ['https://existing.example', true],
      ['https://portal.example', false], ['https://studio.example:444', false], ['https://foreign.example', false]] as const) {
      expect(isLocalSameOrigin({ headers: { host: '127.0.0.1:7456', origin } }, 7456, env)).toBe(allowed);
    }
    expect(isLocalSameOrigin({ headers: { host:'studio.example', 'sec-fetch-site':'same-origin' } },7456,env)).toBe(true);
    expect(isLocalSameOrigin({ headers: { host:'studio.example', 'sec-fetch-site':'cross-site' } },7456,env)).toBe(false);
  });
  it('retains standalone guards and fails closed on partial platform configuration', () => {
    expect(configuredAllowedOrigins({})).toEqual([]);
    expect(() => configuredAllowedOrigins({ OD_PDLC_PUBLIC_ORIGIN:'https://studio.example' })).toThrow();
  });
});
