import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { chmod, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { startServer } from '../src/server.js';
import type { ProjectResponse, ProjectsResponse, ChatRunCreateResponse, ChatRunStatusResponse } from '@open-design/contracts';

test('PDLC keeps Tracker bindings durable and never respawns a failed managed CLI', async () => {
  const originalEnv = { ...process.env };
  const ids = [randomUUID(), randomUUID()];
  const owner = express();
  let issuer = '';
  let modelRequests = 0;
  owner.get('/auth/tokens/introspect', (_req, res) => {
    const now = Date.now();
    res.json({ sub: 'operator', email: 'operator@example.test', display_name: 'Operator',
      scopes: ['open-design:read', 'open-design:write', 'task-tracker:read'],
      observed_at: new Date(now).toISOString(), expires_at: new Date(now + 120000).toISOString(),
      application_access: { schema_version: 1, issuer, subject: 'operator', role: 'user', applications: ['open-design'],
        enforced: true, revision: 1, observed_at: new Date(now).toISOString(), expires_at: new Date(now + 60000).toISOString() } });
  });
  owner.get('/api/v1/projects', (_req, res) => res.json({ projects: ids.map((id, i) => ({ id, key: `T${i}`, name: `Tracker ${i}` })) }));
  owner.get('/v1/models', (_req, res) => res.json({ data: [{ id: 'main-dev' }] }));
  owner.post('/v1/chat/completions', (_req, res) => { modelRequests++; res.sendStatus(500); });
  const peer = owner.listen(0, '127.0.0.1'); await once(peer, 'listening');
  issuer = `http://127.0.0.1:${(peer.address() as { port: number }).port}`;
  const data = process.env.OD_DATA_DIR!;
  const counter = path.join(data, 'managed-cli-count');
  const script = path.join(data, 'managed-cli.cjs');
  const bin = process.platform === 'win32' ? path.join(data, 'managed-cli.cmd') : path.join(data, 'managed-cli');
  await writeFile(script, `const fs=require('node:fs');const a=process.argv.slice(2);
if(a.includes('--version')){console.log('1.18.30');process.exit(0)}
if(a.includes('--help')){console.log('Usage: opencode run --format json --model MODEL');process.exit(0)}
if(a[0]==='models'){console.log('open-design-byok/main-dev');process.exit(0)}
if(a[0]!=='run')process.exit(0);
const f=${JSON.stringify(counter)};fs.appendFileSync(f,JSON.stringify(a)+'\\n');
process.stderr.write('Error: connection reset by peer');process.exit(1);`);
  await writeFile(bin, process.platform === 'win32' ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  if (process.platform !== 'win32') await chmod(bin, 0o755);
  const keyFile = path.join(data, 'pdlc-ai-hub.json');
  await writeFile(keyFile, JSON.stringify({ origin: issuer, model: 'main-dev', key: `aih1_${'a'.repeat(64)}` }));
  Object.assign(process.env, { OD_PDLC_AUTH_ISSUER: issuer, OD_PDLC_CLIENT_ID: 'open-design',
    OD_PDLC_PUBLIC_ORIGIN: 'http://127.0.0.1:8999', OD_PDLC_TRACKER_URL: issuer, OD_NEXT_STRATEGY_ROLLOUT: 'off' });
  let started: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    started = await startServer({ port: 0, returnServer: true });
    const url = (started as any).url;
    const headers = { Authorization: 'Bearer pdlc_pat_fixture', 'Content-Type': 'application/json' };
    const call = async <T = unknown>(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> => {
      const response = await fetch(url + route, { headers, method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json() as T;
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value;
    };
    await call('/api/app-config', { agentId: 'opencode', agentCliEnv: { opencode: { OPENCODE_BIN: bin } } }, 'PUT');
    const works: Array<ProjectResponse & { conversationId: string }> = [];
    for (const binding of [...ids, undefined]) works.push(await call<ProjectResponse & { conversationId: string }>('/api/projects', {
      id: randomUUID(), name: 'Bound work', skipDiscoveryBrief: true,
      metadata: { kind: 'prototype', ...(binding ? { trackerProjectId: binding } : {}) },
    }));
    for (let i = 0; i < ids.length; i++) {
      const list = await call<ProjectsResponse>(`/api/projects?trackerProjectId=${ids[i]}`);
      expect(list.projects.map(p => p.id)).toContain(works[i]!.project.id);
      expect(list.projects.map(p => p.id)).not.toContain(works[1 - i]!.project.id);
    }
    expect((await call<ProjectsResponse>('/api/projects?trackerProjectId=none')).projects.map(p => p.id)).toContain(works[2]!.project.id);
    await call(`/api/projects/${works[0]!.project.id}`, { metadata: { kind: 'prototype', fidelity: 'wireframe' } }, 'PATCH');
    expect((await call<ProjectResponse>(`/api/projects/${works[0]!.project.id}`)).project.metadata?.trackerProjectId).toBe(ids[0]);
    const duplicate = await call<ProjectResponse>(`/api/projects/${works[0]!.project.id}/duplicate`, {});
    expect(duplicate.project.metadata?.trackerProjectId).toBe(ids[0]);
    const created = await call<ChatRunCreateResponse>('/api/runs', { projectId: works[0]!.project.id, conversationId: works[0]!.conversationId,
      agentId: 'opencode', message: 'Create a page', currentPrompt: 'Create a page', assistantMessageId: randomUUID(), clientRequestId: randomUUID() });
    const events = await fetch(`${url}/api/runs/${created.runId}/events`, { headers });
    await events.text();
    const run = await call<ChatRunStatusResponse>(`/api/runs/${created.runId}`);
    expect(run.status).toBe('failed');
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1);
    expect(modelRequests).toBe(0);
    if (!run.eventsLogPath) throw new Error('Run events log is missing');
    const rawEvents = await readFile(run.eventsLogPath, 'utf8');
    expect(rawEvents).not.toContain('run_retry_attempted');
    expect(rawEvents).toContain('PDLC_HUB_OUTCOME_UNKNOWN');
  } finally {
    await (started as any)?.shutdown?.();
    peer.closeAllConnections(); await new Promise<void>(resolve => peer.close(() => resolve()));
    await rm(keyFile, { force: true });
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
}, 60000);
