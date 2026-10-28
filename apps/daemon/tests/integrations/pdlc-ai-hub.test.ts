import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { pdlcAiHubProvider, pdlcInferenceStatus } from '../../src/integrations/pdlc-ai-hub.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'od-hub-'));
const keyFile = path.join(root, 'pdlc-ai-hub.json');
const secret = `aih1_${'a'.repeat(64)}`;
const config = { origin: 'http://hub-local:8191', model: 'studio-main', key: secret };
function load(value: unknown) {
  writeFileSync(keyFile, JSON.stringify(value));
  return pdlcAiHubProvider(root, true);
}
afterEach(() => { rmSync(keyFile, { force: true }); rmSync(path.join(root, 'pdlc-inference.json'), { force: true }); });
afterAll(() => rmSync(root, { recursive: true, force: true }));
test('standalone stays unchanged; partial configuration and nonlocal HTTP fail closed', () => {
  expect(pdlcAiHubProvider(root, true)).toBeNull();
  expect(() => load({ model: 'main' })).toThrow();
  expect(() => load({ ...config, origin: '' })).toThrow('origin is required');
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
  expect(() => load({ ...config, key: 'sensitive-invalid-value' })).toThrow('PDLC inference key is invalid');
  expect(() => load({ ...config, model: 'https://escape.example' })).toThrow('published virtual model slug');
});

test('access checks use the configured key only against the non-inference catalog', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{"data":[{"id":"studio-main"}]}'));
  expect(await pdlcInferenceStatus(load(config), request)).toEqual({ state: 'ready', model: 'studio-main' });
  expect(request).toHaveBeenCalledExactlyOnceWith('http://hub-local:8191/v1/models', expect.objectContaining({
    redirect: 'error', headers: { Authorization: `Bearer ${secret}` },
  }));
  expect(JSON.stringify(await pdlcInferenceStatus(null, request))).not.toContain(secret);
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([[401, 'access_denied'], [403, 'access_denied'], [503, 'hub_unavailable'], [302, 'hub_unavailable']])(
  'catalog HTTP %i produces a safe %s state', async (status, state) => {
    const request = vi.fn().mockResolvedValue(new Response('private upstream detail', { status: Number(status) }));
    expect(await pdlcInferenceStatus(load(config), request)).toEqual({ state, model: 'studio-main' });
  });

test('missing models, malformed replies and timeout remain distinct from access success', async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response('{"data":[{"id":"different-model"}]}'))
    .mockResolvedValueOnce(new Response('{"unexpected":true}')).mockRejectedValueOnce(new Error(secret));
  const provider = load(config);
  expect((await pdlcInferenceStatus(provider, request)).state).toBe('model_unavailable');
  expect((await pdlcInferenceStatus(provider, request)).state).toBe('hub_unavailable');
  expect(await pdlcInferenceStatus(provider, request)).toEqual({ state: 'hub_unavailable', model: 'studio-main' });
});

const directConfig = { transport: 'openai-compatible', baseUrl: 'https://gateway.example/api/v1', model: 'main-dev', key: 'private-direct-key' };
function direct(value: unknown) {
  writeFileSync(path.join(root, 'pdlc-inference.json'), JSON.stringify(value));
  return pdlcAiHubProvider(root, true);
}

test('direct server config overrides the legacy Hub route without exposing its key', async () => {
  load(config);
  const provider = direct(directConfig)!;
  const request = vi.fn().mockResolvedValue(new Response('{"data":[{"id":"main-dev"}]}'));
  expect(await pdlcInferenceStatus(provider, request)).toEqual({ state: 'ready', model: 'main-dev' });
  expect(request).toHaveBeenCalledWith('https://gateway.example/api/v1/models', expect.objectContaining({
    headers: { Authorization: 'Bearer private-direct-key' }, redirect: 'error',
  }));
  expect(provider.env.OD_PDLC_INFERENCE_PROVIDER).toBe(provider.providerId);
  expect(provider.config).toMatchObject({ model: 'open-design-byok/main-dev', small_model: 'open-design-byok/main-dev' });
  expect(JSON.stringify(provider.config)).not.toContain(directConfig.key);
});

test.each(['10.4.5.6', '172.16.0.1', '172.31.255.254', '192.168.10.1'])(
  'private HTTP %s requires installation opt-in', host => {
    const value = { ...directConfig, baseUrl: `http://${host}:4000/v1` };
    expect(() => direct(value)).toThrow('explicitly allowed private HTTP');
    expect(direct({ ...value, allowInsecurePrivateHttp: true })!.catalogUrl).toBe(value.baseUrl + '/models');
  });

test.each(['http://public.example/v1', 'http://172.32.0.1/v1', 'http://192.169.1.1/v1',
  'https://user:password@gateway.example/v1', 'https://gateway.example/v1?key=secret', 'https://gateway.example/v1#fragment'])(
  'direct configuration rejects unsafe URL %s', baseUrl => {
    expect(() => direct({ ...directConfig, baseUrl, allowInsecurePrivateHttp: true })).toThrow();
  });

test('invalid direct config never silently falls back to Hub and key errors are safe', () => {
  load(config);
  expect(() => direct({ ...directConfig, key: 'secret\nheader' })).toThrow('PDLC inference key is invalid');
  expect(() => direct({ ...directConfig, transport: 'unknown' })).toThrow('transport');
  writeFileSync(path.join(root, 'pdlc-inference.json'), '{invalid');
  expect(() => pdlcAiHubProvider(root, true)).toThrow('private configuration is unavailable or invalid');
});
