import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { pdlcAiHubProvider } from '../../src/integrations/pdlc-ai-hub.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'od-hub-'));
const keyFile = path.join(root, 'key');
const secret = `aih1_${'a'.repeat(64)}`;
const env = {
  OD_PDLC_AUTH_ISSUER: 'https://auth.example', OD_PDLC_AI_HUB_URL: 'http://hub-local:8191',
  OD_PDLC_AI_HUB_MODEL: 'studio-main', OD_PDLC_AI_HUB_KEY_FILE: keyFile,
};
afterEach(() => rmSync(keyFile, { force: true }));
afterAll(() => rmSync(root, { recursive: true, force: true }));
test('standalone stays unchanged; partial configuration and nonlocal HTTP fail closed', () => {
  expect(pdlcAiHubProvider({})).toBeNull();
  expect(() => pdlcAiHubProvider({ OD_PDLC_AI_HUB_MODEL: 'main' })).toThrow();
  expect(() => pdlcAiHubProvider({ ...env, OD_PDLC_AI_HUB_URL: 'http://public.example' })).toThrow();
  expect(() => pdlcAiHubProvider({ ...env, OD_PDLC_AI_HUB_URL: 'https://hub.example/redirect' })).toThrow();
});
test('server-owned provider uses only its private file and a single published model', () => {
  writeFileSync(keyFile, secret);
  const result = pdlcAiHubProvider(env)!;
  expect(result.modelId).toBe('open-design-byok/studio-main');
  expect(result.env.OPEN_DESIGN_BYOK_API_KEY).toBe(secret);
  expect(JSON.stringify(result.config)).not.toContain(secret);
  expect(result.config).toMatchObject({
    model: result.modelId, small_model: result.modelId,
    enabled_providers: ['open-design-byok'],
    provider: { 'open-design-byok': { options: { baseURL: 'http://hub-local:8191/v1' } } },
  });
});
test('key errors disclose neither the credential nor filesystem details', () => {
  expect(() => pdlcAiHubProvider(env)).toThrow('PDLC AI Hub key file is unavailable');
  writeFileSync(keyFile, 'sensitive-invalid-value');
  expect(() => pdlcAiHubProvider(env)).toThrow('PDLC AI Hub key file is invalid');
  expect(() => pdlcAiHubProvider({ ...env, OD_PDLC_AI_HUB_MODEL: 'https://escape.example' })).toThrow('published virtual model slug');
});
