import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const tracker = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function cli(args: string[], input = '', status = 200) {
  const requests: Array<{ method: string; url: string; body: unknown; authorization: string | undefined }> = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : null, authorization: req.headers.authorization });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(status !== 200 ? { error: { code: 'PDLC_LOGIN_REQUIRED', message: 'Login required: pdlc_pat_contract' } }
      : req.url === '/api/workspace/directory' ? { items: [] }
      : req.method === 'POST' ? { project: JSON.parse(raw) } : { projects: [] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const env: NodeJS.ProcessEnv = { ...process.env, PDLC_API_TOKEN: 'pdlc_pat_contract' }; delete env.OD_TOOL_TOKEN;
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
    ...args, '--json', '--daemon-url', `http://127.0.0.1:${(server.address() as { port: number }).port}`], { env });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const [code, signal] = await once(child, 'close');
    expect(signal, stderr).toBeNull();
    return { code, stdout, stderr, requests };
  } finally {
    clearTimeout(timer); child.kill(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

it.each(['{', 'null', '[]', '"value"', '7'])('rejects invalid metadata %s without creating a work', async input => {
  const result = await cli(['project', 'create', '--name', 'Metadata', '--metadata-json', '-'], input);
  expect(result.code).toBe(2); expect(result.stdout).toBe('');
  expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'CLI_USAGE' } });
  expect(result.requests.some(req => req.method === 'POST')).toBe(false);
});

it('rejects an absent file and accepts a real file or stdin', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-cli-metadata-'));
  try {
    const file = path.join(dir, 'metadata.json');
    const missing = await cli(['project', 'create', '--name', 'Missing', '--metadata-json', file]);
    expect(missing.code).toBe(2); expect(missing.requests.some(req => req.method === 'POST')).toBe(false);
    const metadata = { kind: 'prototype', trackerProjectId: tracker };
    await writeFile(file, JSON.stringify(metadata));
    for (const [source, input] of [[file, ''], ['-', JSON.stringify(metadata)]]) {
      const result = await cli(['project', 'create', '--name', 'Bound', '--metadata-json', source!], input);
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).project.metadata).toEqual(metadata);
      expect(result.requests.find(req => req.method === 'POST')?.authorization).toBe('Bearer pdlc_pat_contract');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60000);

it.each([undefined, tracker, 'none'])('passes optional Tracker filter %s to the existing API', async value => {
  const result = await cli(['project', 'list', ...(value ? ['--tracker-project', value] : [])]);
  expect(result.code, result.stderr).toBe(0);
  expect(result.requests.at(-1)?.url).toBe('/api/projects' + (value ? `?trackerProjectId=${value}` : ''));
});

it.each([['plugin', 'list'], ['plugin', 'sources'], ['daemon', 'db', 'status'], ['automation', 'list'], ['skill', 'install', 'github:example/skill']])(
  'returns structured Auth errors for %s %s', async (...args) => {
    const result = await cli(args, '', 401);
    expect(result.code).toBe(1); expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'PDLC_LOGIN_REQUIRED' } });
    expect(result.stderr).not.toContain('pdlc_pat_contract');
  },
);
