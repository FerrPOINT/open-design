import { createServer, type RequestListener, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { daemonFetch, rememberDaemonUrl } from '../../src/daemon-fetch.js';
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
async function serve(handler: RequestListener) {
  const server = createServer(handler); servers.push(server); server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
it('sends PAT and correlation only to the selected daemon, preserving narrower tool authority', async () => {
  vi.stubEnv('PDLC_API_TOKEN', 'pdlc_pat_private');
  const handler: RequestListener = (req, res) => res.end(JSON.stringify(req.headers));
  const origin = rememberDaemonUrl(await serve(handler));
  const foreign = await serve(handler);
  const own = await (await daemonFetch(origin + '/api/projects')).json();
  expect(own).toMatchObject({ authorization: 'Bearer pdlc_pat_private', 'x-request-id': expect.stringMatching(/^od-cli-/) });
  const other = await (await daemonFetch(foreign + '/api/projects')).json();
  expect(other).not.toHaveProperty('authorization');
  const scoped = await (await daemonFetch(origin + '/api/tools/library/search', { headers: { Authorization: 'Bearer odtt_narrow' } })).json();
  expect(scoped).toMatchObject({ authorization: 'Bearer odtt_narrow' });
});
it('never follows a daemon redirect with credentials', async () => {
  vi.stubEnv('PDLC_API_TOKEN', 'pdlc_pat_private'); let reached = false;
  const target = await serve((_req, res) => { reached = true; res.end(); });
  const origin = rememberDaemonUrl(await serve((_req, res) => { res.writeHead(302, { Location: target }); res.end(); }));
  await expect(daemonFetch(origin)).rejects.toThrow('HTTP request failed');
  expect(reached).toBe(false);
});
it('rejects credentials in the endpoint and non-loopback HTTP', () => {
  for (const url of ['https://user:secret@example.test', 'http://example.test', 'http://192.168.1.3']) {
    expect(() => rememberDaemonUrl(url)).toThrow();
  }
  expect(rememberDaemonUrl('http://127.0.0.3:8193')).toBe('http://127.0.0.3:8193');
});
