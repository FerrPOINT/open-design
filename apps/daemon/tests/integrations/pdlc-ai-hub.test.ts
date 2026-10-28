import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { pdlcAiHubProvider } from '../../src/integrations/pdlc-ai-hub.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'od-hub-'));
const keyFile = path.join(root, 'pdlc-ai-hub.json');
const secret = `aih1_${'a'.repeat(64)}`;
const config = { origin: 'http://hub-local:8191', model: 'studio-main', key: secret };
function load(value: unknown) {
  writeFileSync(keyFile, JSON.stringify(value));
  return pdlcAiHubProvider(root, true);
}
afterEach(() => rmSync(keyFile, { force: true }));
afterAll(() => rmSync(root, { recursive: true, force: true }));
test('standalone stays unchanged; partial configuration and nonlocal HTTP fail closed', () => {
  expect(pdlcAiHubProvider(root, true)).toBeNull();
  expect(() => load({ model: 'main' })).toThrow();
  expect(() => load({ ...config, origin: 'http://public.example' })).toThrow();
  expect(() => load({ ...config, origin: 'https://hub.example/redirect' })).toThrow();
  expect(pdlcAiHubProvider(root, false)).toBeNull();
});
test('server-owned provider uses only its private file and a single published model', () => {
  const result = load(config)!;
  expect(result.modelId).toBe('open-design-byok/studio-main');
  expect(result.env.OPEN_DESIGN_BYOK_API_KEY).toBe(secret);
  expect(result.env.XDG_DATA_HOME).toBe(path.join(root, 'agent-runtime', 'opencode', 'data'));
  expect(result.env.OPENCODE_DISABLE_MODELS_FETCH).toBe('true');
  expect(JSON.stringify(result.config)).not.toContain(secret);
  expect(result.config).toMatchObject({
    model: result.modelId, small_model: result.modelId,
    enabled_providers: ['open-design-byok'],
    provider: { 'open-design-byok': { options: { baseURL: 'http://hub-local:8191/v1' } } },
  });
});
test('key errors disclose neither the credential nor filesystem details', () => {
  writeFileSync(keyFile, '{bad json');
  expect(() => pdlcAiHubProvider(root, true)).toThrow('private configuration is unavailable or invalid');
  writeFileSync(keyFile, 'sensitive-invalid-value');
  expect(() => load({ ...config, key: 'sensitive-invalid-value' })).toThrow('PDLC AI Hub key is invalid');
  expect(() => load({ ...config, model: 'https://escape.example' })).toThrow('published virtual model slug');
});
