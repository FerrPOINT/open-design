import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { OPEN_CODE_EVENT_PLUGIN_SOURCE } from '../../src/runtimes/opencode-event-plugin.js';

async function transport(fetch: typeof globalThis.fetch, managed = true, proxyUrl?: string) {
  const factory = vm.runInNewContext(OPEN_CODE_EVENT_PLUGIN_SOURCE.replace('export default', '(') + ')', {
    process: { env: managed ? { OD_PDLC_INFERENCE_PROVIDER: 'open-design-byok', ...(proxyUrl ? { OD_PDLC_INFERENCE_PROXY: proxyUrl } : {}) } : {} },
    Request, Response, Headers, URL, crypto: webcrypto, TextEncoder, TextDecoder, ReadableStream, fetch,
  });
  const config = { provider: { 'open-design-byok': { options: { baseURL: 'https://hub.example/v1' } } } };
  await (await factory()).config(config);
  return config.provider['open-design-byok'].options as { fetch?: typeof fetch };
}
const endpoint = 'https://hub.example/v1/chat/completions';
const init = (body = '{"model":"studio-main","messages":[]}') => ({ method: 'POST', body, headers: { Authorization: 'Bearer private-key' } });
const done = () => new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
test('does not change standalone providers', async () => {
  const original = vi.fn();
  expect((await transport(original, false)).fetch).toBeUndefined();
  expect(original).not.toHaveBeenCalled();
});
test('the installation proxy preserves the destination guard and retry UUID', async () => {
  const upstream = vi.fn().mockRejectedValueOnce(new Error('connection reset')).mockImplementation(async () => done());
  const client = (await transport(upstream as typeof fetch, true, 'http://proxy.test:3128')).fetch!;
  await expect(client('https://wrong.example/v1/chat/completions', init())).rejects.toThrow('destination refused');
  await expect(client(endpoint, init())).rejects.toThrow('connection reset');
  await (await client(endpoint, init())).text();
  expect(upstream).toHaveBeenCalledTimes(2);
  const [first, second] = upstream.mock.calls;
  expect(first?.[1]).toEqual({ proxy: { url: 'http://proxy.test:3128', respectNoProxy: false } });
  expect(first?.[0].headers.get('Idempotency-Key')).toBe(second?.[0].headers.get('Idempotency-Key'));
  expect(second?.[0].redirect).toBe('error');
});
test('refuses credential redirection and carries bearer only to the configured endpoint', async () => {
  const requests: Request[] = [];
  const upstream = vi.fn(async (request: Request) => { requests.push(request); return done(); });
  const client = (await transport(upstream as typeof fetch)).fetch!;
  await expect(client('https://other.example/v1/chat/completions', init())).rejects.toThrow('destination refused');
  await expect(client(endpoint, { method: 'GET' })).rejects.toThrow('destination refused');
  await (await client(endpoint, init())).text();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.headers.get('Authorization')).toBe('Bearer private-key');
  expect(requests[0]!.redirect).toBe('error');
  expect(requests[0]!.headers.get('Idempotency-Key')).toMatch(/^[a-f0-9-]{36}$/);
});
test('an uncertain retry retains its UUID; a changed tool step and completed new request get new UUIDs', async () => {
  const keys: string[] = [];
  const upstream = vi.fn(async (request: Request) => {
    keys.push(request.headers.get('Idempotency-Key')!);
    if (keys.length === 1) throw new Error('connection reset after admission');
    return done();
  });
  const client = (await transport(upstream as typeof fetch)).fetch!;
  await expect(client(endpoint, init())).rejects.toThrow('connection reset');
  // A changed tool history is a distinct request, not a retry of the old payload.
  await (await client(endpoint, init('{"model":"studio-main","messages":[{"role":"tool"}]}'))).text();
  await (await client(endpoint, init())).text();
  await (await client(endpoint, init())).text();
  expect(keys[0]).toBe(keys[2]);
  expect(keys[1]).not.toBe(keys[0]);
  expect(keys[3]).not.toBe(keys[2]);
});
test.each(['data: {"choices":[]}\n\n', 'data: [DONE]', 'data: [DONE]\n', 'data: [DONE]invalid\n\n'])('incomplete or invalid DONE retains its UUID: %j', async (body) => {
  const keys: string[] = [];
  const upstream = vi.fn(async (request: Request) => {
    keys.push(request.headers.get('Idempotency-Key')!);
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const client = (await transport(upstream as typeof fetch)).fetch!;
  await (await client(endpoint, init())).text();
  await (await client(endpoint, init())).text();
  expect(keys[1]).toBe(keys[0]);
});
