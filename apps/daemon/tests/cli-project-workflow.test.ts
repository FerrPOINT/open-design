import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

async function invoke(args: string[], status = 200) {
  const requests: Array<{ method: string; url: string; body: unknown; token: string | undefined; workspace: string | undefined }> = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : null,
      token: req.headers.authorization, workspace: req.headers['x-od-workspace-id'] as string | undefined });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(status === 200
      ? req.url === '/api/conversations/c1' ? { conversation: { id: 'c1', projectId: 'p1' } }
        : req.url === '/api/pdlc/projects' ? { projects: [{ id: 'tracker-1', key: 'BASE', name: 'Платформа' }] }
        : { ok: true, messages: [] }
      : { error: { code: 'PDLC_LOGIN_REQUIRED', message: 'Denied pdlc_pat_workflow' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const env: NodeJS.ProcessEnv = { ...process.env, PDLC_API_TOKEN: 'pdlc_pat_workflow' };
  delete env.OD_TOOL_TOKEN;
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
    ...args, '--json', '--daemon-url', `http://127.0.0.1:${(server.address() as { port: number }).port}`], { env });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end();
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [code, signal] = await once(child, 'close');
    expect(signal, stderr).toBeNull();
    return { code, stdout, stderr, requests };
  } finally {
    clearTimeout(timeout); child.kill(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

it('lists the Tracker catalog using the current PAT', async () => {
  const result = await invoke(['tracker', 'projects']);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).projects[0]).toMatchObject({ key: 'BASE', name: 'Платформа' });
  expect(result.requests).toMatchObject([{ method: 'GET', url: '/api/pdlc/projects', token: 'Bearer pdlc_pat_workflow' }]);
});

it('renames a nested Unicode file through the existing project API', async () => {
  const result = await invoke(['files', 'rename', 'p1', 'черновики/мой сайт.html', 'готово/сайт.html']);
  expect(result.code, result.stderr).toBe(0);
  expect(result.requests).toMatchObject([{ method: 'POST', url: '/api/projects/p1/files/rename',
    body: { from: 'черновики/мой сайт.html', to: 'готово/сайт.html' }, token: 'Bearer pdlc_pat_workflow' }]);
});

it.each([
  ['info', [], 'GET', '/api/conversations/c1', null],
  ['messages', [], 'GET', '/api/projects/p1/conversations/c1/messages', null],
  ['rename', ['--title', 'Новая беседа'], 'PATCH', '/api/projects/p1/conversations/c1', { title: 'Новая беседа' }],
  ['delete', [], 'DELETE', '/api/projects/p1/conversations/c1', null],
] as const)('conversation %s resolves its parent without scanning projects', async (sub, extra, method, url, body) => {
  const result = await invoke(['conversation', sub, 'c1', ...extra, '--workspace', 'w1', '--workspace-member', 'm1']);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  expect(() => JSON.parse(result.stdout)).not.toThrow();
  expect(result.requests).toHaveLength(sub === 'info' ? 1 : 2);
  expect(result.requests.at(-1)).toMatchObject({ method, url, body, token: 'Bearer pdlc_pat_workflow' });
  expect(result.requests.every(req => req.token === 'Bearer pdlc_pat_workflow')).toBe(true);
  expect(result.requests.every(req => req.workspace === 'w1')).toBe(true);
});

it.each([['tracker', 'projects'], ['files', 'rename', 'p1', 'a', 'b'], ['conversation', 'messages', 'c1'],
  ['conversation', 'rename', 'c1', '--title', 'New'], ['conversation', 'delete', 'c1']])(
  'returns safe JSON auth errors for %s %s', async (...args) => {
    const result = await invoke(args, 401);
    expect(result.code).toBe(1); expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'PDLC_LOGIN_REQUIRED' } });
    expect(result.stderr).not.toContain('pdlc_pat_workflow');
    expect(result.requests).toHaveLength(1);
  });

it.each([['files', 'rename', 'p1', 'a'], ['conversation', 'rename', 'c1'], ['conversation', 'messages']])(
  'rejects incomplete %s %s before any request', async (...args) => {
    const result = await invoke(args);
    expect(result.code).toBe(2); expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'CLI_USAGE' } });
    expect(result.requests).toHaveLength(0);
  });
