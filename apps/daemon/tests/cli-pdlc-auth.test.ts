import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.each([['list', '--json'], ['create', '--name', 'Authorization QA', '--json']])(
  'returns a structured authorization refusal for project %s without a native crash', async (...args) => {
    const received: Array<string | undefined> = [];
    const server = createServer((req, res) => {
      received.push(req.headers.authorization);
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'PDLC_LOGIN_REQUIRED', message: 'Login required' } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
      'project', ...args, '--daemon-url', `http://127.0.0.1:${(server.address() as { port: number }).port}`],
      { env: { ...process.env, PDLC_API_TOKEN: 'pdlc_pat_fixture' } });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), 10_000);
    try {
      const [code, signal] = await once(child, 'close');
      expect(signal).toBeNull();
      expect(code).toBe(1);
      expect(JSON.parse(stderr)).toMatchObject({ error: { code: 'PDLC_LOGIN_REQUIRED' } });
      expect(stderr).not.toMatch(/UV_HANDLE_CLOSING|pdlc_pat_fixture/);
      expect(received.length).toBeGreaterThan(0);
      expect(received.every(value => value === 'Bearer pdlc_pat_fixture')).toBe(true);
    } finally {
      clearTimeout(timer);
      child.kill();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  },
);
