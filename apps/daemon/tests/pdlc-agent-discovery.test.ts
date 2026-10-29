import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
const probes = vi.hoisted(() => ({ batch: vi.fn(async (_env: unknown) => [{ id: 'opencode', available: true }]), stream: vi.fn() }));
vi.mock('../src/agents.js', () => ({
  detectAgents: probes.batch,
  detectAgentsStream: async function* (env: unknown) { probes.stream(env); yield { id: 'opencode', available: true }; },
}));
import { registerStaticResourceRoutes } from '../src/routes/static-resource.js';

test.each([false, true])('native agent discovery applies private runtime config to batch and stream: managed=%s', async managed => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'od-discovery-'));
  const privateEnv = { opencode: { XDG_DATA_HOME: root, OPEN_DESIGN_BYOK_API_KEY: 'private-test-key' } };
  const app = express();
  registerStaticResourceRoutes(app, {
    db: {}, http: {}, resources: {}, paths: { RUNTIME_DATA_DIR: root },
    ...(managed ? { agentEnvironments: () => privateEnv } : {}),
  } as any);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const batch = await (await fetch(base + '/api/agents')).text();
    const stream = await (await fetch(base + '/api/agents?stream=1')).text();
    expect(batch).toContain('opencode'); expect(stream).toContain('event: done');
    expect(probes.batch).toHaveBeenLastCalledWith(managed ? privateEnv : {});
    expect(probes.stream).toHaveBeenLastCalledWith(managed ? privateEnv : {});
    expect(batch + stream).not.toContain('private-test-key');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
