import express from 'express';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { startServer } from '../src/server.js';

test('real od covers Tracker, source files, history and fake generation with current PAT permissions', async () => {
  const originalEnv = { ...process.env };
  const trackerIds = [randomUUID(), randomUUID()];
  let issuer = '', revoked = false, expired = false, trackerDenied = false;
  const owner = express();
  owner.get('/auth/tokens/introspect', (req, res) => {
    const token = req.get('authorization') ?? '';
    if (revoked) return res.sendStatus(401);
    const now = Date.now();
    return res.json({ sub: 'operator', email: 'operator@example.test', display_name: 'Operator',
      scopes: ['open-design:read', ...(token.includes('readonly') ? [] : ['open-design:write']), 'task-tracker:read'],
      observed_at: new Date(now).toISOString(), expires_at: new Date(now + (expired ? -1000 : 120000)).toISOString(),
      application_access: { schema_version: 1, issuer, subject: 'operator', role: 'user', applications: ['open-design'],
        enforced: true, revision: 1, observed_at: new Date(now).toISOString(), expires_at: new Date(now + 60000).toISOString() } });
  });
  owner.get('/api/v1/projects', (req, res) => {
    expect(req.get('authorization')).toMatch(/^Bearer pdlc_pat_/);
    return trackerDenied ? res.sendStatus(403) : res.json({ projects: trackerIds.map((id, i) => ({ id, key: `T${i}`, name: `Tracker ${i}` })) });
  });
  owner.get('/v1/models', (_req, res) => res.json({ data: [{ id: 'main-dev' }] }));
  owner.post('/v1/chat/completions', () => { throw new Error('No inference requests allowed'); });
  const peer = owner.listen(0, '127.0.0.1'); await once(peer, 'listening');
  issuer = `http://127.0.0.1:${(peer.address() as { port: number }).port}`;
  const data = process.env.OD_DATA_DIR!;
  const counter = path.join(data, 'workflow-run-count');
  const hold = path.join(data, 'workflow-hold');
  const script = path.join(data, 'workflow-agent.cjs');
  const bin = path.join(data, process.platform === 'win32' ? 'workflow-agent.cmd' : 'workflow-agent');
  await writeFile(script, `const fs=require('node:fs'),a=process.argv.slice(2);
if(a.includes('--version')){console.log('1.18.30');process.exit(0)}
if(a.includes('--help')){console.log('Usage: opencode run --format json --model MODEL');process.exit(0)}
if(a[0]==='models'){console.log('open-design-byok/main-dev');process.exit(0)}
if(a[0]!=='run')process.exit(0);
fs.appendFileSync(${JSON.stringify(counter)},JSON.stringify(a)+'\\n');
if(fs.existsSync(${JSON.stringify(hold)})){setInterval(()=>{},1000)}else{
fs.writeFileSync('index.html','<!doctype html><html><body>Сайт с мишками '+fs.readFileSync(${JSON.stringify(counter)},'utf8').trim().split('\\n').length+'</body></html>');
fs.writeFileSync('заметки с пробелами.txt','Не потерять');
console.log(JSON.stringify({type:'text',sessionID:'ses_workflow',part:{type:'text',text:'Updated index.html'}}));
console.log(JSON.stringify({type:'step_finish',sessionID:'ses_workflow',part:{type:'step-finish',tokens:{input:1,output:1},cost:0}}));
}`);
  await writeFile(bin, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  if (process.platform !== 'win32') await chmod(bin, 0o755);
  const keyFile = path.join(data, 'pdlc-ai-hub.json');
  await writeFile(keyFile, JSON.stringify({ origin: issuer, model: 'main-dev', key: `aih1_${'b'.repeat(64)}` }));
  Object.assign(process.env, { OD_PDLC_AUTH_ISSUER: issuer, OD_PDLC_CLIENT_ID: 'open-design',
    OD_PDLC_PUBLIC_ORIGIN: 'http://127.0.0.1:8999', OD_PDLC_TRACKER_URL: issuer, OD_NEXT_STRATEGY_ROLLOUT: 'off' });
  let started: Awaited<ReturnType<typeof startServer>>;
  try {
    started = await startServer({ port: 0, returnServer: true });
    const url = (started as { url: string }).url;
    const cli = async (args: string[], input = '', token = 'pdlc_pat_workflow') => {
      const env: NodeJS.ProcessEnv = { ...process.env, PDLC_API_TOKEN: token }; delete env.OD_TOOL_TOKEN;
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
        ...args, '--json', '--daemon-url', url], { env });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.stdin.end(input);
      const timeout = setTimeout(() => child.kill(), 20000);
      try {
        const [code, signal] = await once(child, 'close');
        expect(signal, stderr).toBeNull();
        return { code, stdout, stderr };
      } finally { clearTimeout(timeout); child.kill(); }
    };
    const ok = async (args: string[], input = '') => {
      const result = await cli(args, input); expect(result.code, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    };
    const read = async (id: string, name: string) => {
      const result = await cli(['files', 'read', id, name]); expect(result.code, result.stderr).toBe(0); return result.stdout;
    };
    expect((await ok(['tracker', 'projects'])).projects.map((p: { id: string }) => p.id)).toEqual(trackerIds);
    const works: string[] = [];
    for (const trackerProjectId of [...trackerIds, undefined]) {
      const work = await ok(['project', 'create', '--name', 'CLI workflow', '--metadata-json', '-'], JSON.stringify({ kind: 'prototype', ...(trackerProjectId ? { trackerProjectId } : {}) }));
      works.push(work.project.id);
    }
    for (const [i, filter] of [...trackerIds, 'none'].entries()) {
      const ids = (await ok(['project', 'list', '--tracker-project', filter])).projects.map((p: { id: string }) => p.id);
      expect(ids).toContain(works[i]); expect(ids).not.toContain(works[(i + 1) % 3]);
    }
    const id = works[0]!;
    const original = '<!doctype html><html><body>Привет</body></html>';
    await ok(['files', 'write', id, 'index.html'], original);
    expect(await read(id, 'index.html')).toBe(original);
    const version = await ok(['files', 'version-create', id, 'index.html']);
    expect((await ok(['files', 'versions', id, 'index.html'])).versions.length).toBeGreaterThan(0);
    await ok(['files', 'write', id, 'index.html'], original.replace('Привет', 'Изменено'));
    await ok(['files', 'version-restore', id, 'index.html', version.version.id]);
    expect(await read(id, 'index.html')).toBe(original);
    const written = await ok(['files', 'write', id, 'черновики/мой сайт.txt'], 'Содержимое');
    expect(written.file.name).toBe('черновики/мой-сайт.txt');
    await ok(['files', 'rename', id, written.file.name, 'готово/сайт.txt']);
    expect(await read(id, 'готово/сайт.txt')).toBe('Содержимое');
    await ok(['files', 'write', id, 'занято.txt'], 'Сохранить');
    expect((await cli(['files', 'rename', id, 'готово/сайт.txt', 'занято.txt'])).code).not.toBe(0);
    expect(await read(id, 'занято.txt')).toBe('Сохранить');
    const conversation = (await ok(['conversation', 'new', id, '--title', 'Беседа'])).conversation;
    expect((await ok(['conversation', 'info', conversation.id])).conversation.projectId).toBe(id);
    await ok(['conversation', 'rename', conversation.id, '--title', 'Новая беседа']);
    expect((await ok(['conversation', 'info', conversation.id])).conversation.title).toBe('Новая беседа');
    const config = await fetch(url + '/api/app-config', { method: 'PUT', headers: { Authorization: 'Bearer pdlc_pat_workflow', 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'opencode', agentCliEnv: { opencode: { OPENCODE_BIN: bin } } }) });
    expect(config.status).toBe(200);
    for (const [i, message] of ['Создай страницу', 'Добавь мишек'].entries()) {
      const run = await ok(['run', 'start', '--project', id, '--conversation', conversation.id, '--message', message]);
      const watched = await cli(['run', 'watch', run.runId]); expect(watched.code, watched.stderr).toBe(0);
      expect((await ok(['run', 'info', run.runId])).status).toBe('succeeded');
      expect((await ok(['run', 'result-package', run.runId])).run.id).toBe(run.runId);
      expect(await read(id, 'index.html')).toContain(`Сайт с мишками ${i + 1}`);
    }
    expect(await read(id, 'index.html')).toContain('Сайт с мишками');
    const history = (await ok(['conversation', 'messages', conversation.id])).messages;
    expect(JSON.stringify(history)).toContain('Updated index.html');
    expect(JSON.stringify(history)).toContain('Создай страницу');
    expect(JSON.stringify(history)).toContain('Добавь мишек');
    const renamed = await ok(['files', 'rename', id, 'заметки с пробелами.txt', 'готово/мои заметки.txt']);
    expect(renamed.newName).toBe('готово/мои-заметки.txt');
    expect(await read(id, renamed.newName)).toBe('Не потерять');
    await writeFile(hold, 'hold');
    const held = await ok(['run', 'start', '--project', id, '--conversation', conversation.id, '--message', 'Wait']);
    await expect.poll(async () => (await readFile(counter, 'utf8')).trim().split('\n').length, { timeout: 10000 }).toBe(3);
    const unsupported = await cli(['run', 'steer', held.runId, '--message', 'Change']);
    expect(JSON.parse(unsupported.stderr).error.code).toBe('RUN_STEERING_UNSUPPORTED');
    await ok(['run', 'cancel', held.runId]);
    const canceled = await cli(['run', 'watch', held.runId]); expect(canceled.code, canceled.stderr).toBe(0);
    expect(canceled.stdout.trim().split('\n').map(line => JSON.parse(line)).at(-1).event).toBe('end');
    const continued = await cli(['run', 'continue', held.runId]);
    expect(continued.code).not.toBe(0);
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(3);
    const headers = { Authorization: 'Bearer pdlc_pat_workflow' };
    expect((await fetch(`${url}/api/conversations/comment-anchor-${id}`, { headers })).status).toBe(404);
    expect((await cli(['conversation', 'info', 'missing'])).code).not.toBe(0);
    const foreign = await fetch(`${url}/api/projects/${works[1]}/conversations/${conversation.id}/messages`, { headers });
    expect(foreign.status).toBe(404);
    expect((await cli(['conversation', 'messages', conversation.id], '', 'pdlc_pat_readonly')).code).toBe(0);
    const denied = await cli(['conversation', 'rename', conversation.id, '--title', 'Denied'], '', 'pdlc_pat_readonly');
    expect(denied.code).toBe(1); expect(denied.stdout).toBe(''); expect(denied.stderr).not.toContain('pdlc_pat_readonly');
    trackerDenied = true;
    expect((await cli(['tracker', 'projects'])).code).toBe(1);
    expect(await read(id, 'index.html')).toContain('Сайт с мишками');
    trackerDenied = false;
    expired = true; expect((await cli(['conversation', 'info', conversation.id])).code).toBe(1); expired = false;
    revoked = true; expect((await cli(['tracker', 'projects'])).code).toBe(1); revoked = false;
    await ok(['conversation', 'delete', conversation.id]);
    expect((await cli(['conversation', 'info', conversation.id])).code).not.toBe(0);
  } finally {
    await (started! as { shutdown?: () => Promise<void> } | undefined)?.shutdown?.();
    peer.closeAllConnections(); await new Promise<void>(resolve => peer.close(() => resolve()));
    await rm(keyFile, { force: true });
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
}, 180000);
