import express from 'express';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPdlcVerifier, installPdlcAuth, watchPdlcAuthorization, type PdlcPrincipal } from '../../src/http/pdlc-auth.js';
import { pdlcConfiguration } from '../../src/http/pdlc-config.js';

let owner: Server;
let studio: Server;
let origin: string;
let issuer: string;
let scopes: string[];
let applications: string[];
let status: number;
let expires: number;
let dispose: () => void;
beforeEach(async () => {
  scopes = ['open-design:read']; applications = ['open-design']; status = 200;
  expires = Date.now() + 120_000;
  const auth = express();
  auth.get('/auth/tokens/introspect', (req, res) => {
    expect(req.query.include_lifetime).toBe('true');
    expect(req.get('authorization')).toBe('Bearer pdlc_pat_test');
    if (status !== 200) return res.sendStatus(status);
    const now = Date.now();
    return res.json({ sub: 'alice', email: 'alice@example.test', display_name: 'Alice',
      scopes, expires_at: new Date(expires).toISOString(), observed_at: new Date(now).toISOString(),
      application_access: { schema_version: 1, issuer, subject: 'alice', role: 'user', applications,
        revision: 1, enforced: true, observed_at: new Date(now).toISOString(),
        expires_at: new Date(now + 60_000).toISOString() } });
  });
  owner = auth.listen(0, '127.0.0.1'); await once(owner, 'listening');
  issuer = `http://127.0.0.1:${(owner.address() as { port: number }).port}`;
  const config = { issuer, clientId: 'open-design', publicOrigin: 'https://studio.example',
    hostOrigin: null, catalogUrl: null, applicationKey: 'open-design' as const };
  const app = express();
  ({ dispose } = installPdlcAuth(app, config, undefined, undefined, undefined,
    async () => ({ state: 'model_unavailable', model: 'studio-main' })));
  app.get('/api/projects', (_req, res) => res.json({ credential: res.locals.pdlc.credential }));
  app.post('/api/projects', (_req, res) => res.json({ ok: true }));
  studio = app.listen(0, '127.0.0.1'); await once(studio, 'listening');
  origin = `http://127.0.0.1:${(studio.address() as { port: number }).port}`;
});
afterEach(async () => {
  dispose();
  for (const server of [studio, owner]) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
const headers = { Authorization: 'Bearer pdlc_pat_test' };
it('protects model readiness and exposes only its public status to a read PAT', async () => {
  expect((await fetch(origin + '/api/pdlc/inference/status')).status).toBe(401);
  const result = await fetch(origin + '/api/pdlc/inference/status', { headers });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ state: 'model_unavailable', model: 'studio-main' });
});
it('admits read PATs without a fabricated browser SID and requires write scope for mutations', async () => {
  const response = await fetch(origin + '/api/projects', { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ credential: { kind: 'pat', scopes: ['open-design:read'] } });
  expect((await fetch(origin + '/api/projects', { method: 'POST', headers })).status).toBe(403);
  scopes.push('open-design:write');
  expect((await fetch(origin + '/api/projects', { method: 'POST', headers })).status).toBe(200);
});
it('checks current app admission, expiry and revocation on each request', async () => {
  applications = [];
  expect((await fetch(origin + '/api/projects', { headers })).status).toBe(403);
  applications = ['open-design']; expires = Date.now() - 1;
  expect((await fetch(origin + '/api/projects', { headers })).status).toBe(401);
  expires = Date.now() + 120_000; status = 401;
  expect((await fetch(origin + '/api/projects', { headers })).status).toBe(401);
  status = 503;
  expect((await fetch(origin + '/api/projects', { headers })).status).toBe(503);
});
it('does not exchange a PAT for a browser cookie', async () => {
  const response = await fetch(origin + '/api/pdlc/session', {
    method: 'POST', headers: { ...headers, Origin: 'https://studio.example' },
  });
  expect(response.status).toBe(403); expect(response.headers.get('set-cookie')).toBeNull();
});
it('supports the installation loopback address while rejecting external HTTP', () => {
  const env = { OD_PDLC_AUTH_ISSUER: 'http://127.0.0.3:8101', OD_PDLC_CLIENT_ID: 'open-design',
    OD_PDLC_PUBLIC_ORIGIN: 'http://127.0.0.3:8193' };
  expect(pdlcConfiguration(env)?.issuer).toBe(env.OD_PDLC_AUTH_ISSUER);
  expect(() => pdlcConfiguration({ ...env, OD_PDLC_PUBLIC_ORIGIN: 'http://192.168.1.3' })).toThrow();
});

it('revokes a running operation at the next proof deadline and disposes finished monitors', async () => {
  const authorize = vi.fn(async (): Promise<PdlcPrincipal> => ({
    identity: { subject: 'alice', email: 'alice@example.test', displayName: 'Alice' },
    credential: { kind: 'pat', scopes: ['open-design:write'] },
    expiresAt: Date.now() + 120_000, deadline: performance.now() + 20,
  }));
  const revoked = vi.fn();
  const stop = watchPdlcAuthorization({ key: 'test', authorize }, revoked);
  await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(1), { interval: 1 });
  authorize.mockRejectedValue(new Error('revoked'));
  await vi.waitFor(() => expect(revoked).toHaveBeenCalledTimes(1), { interval: 5 });
  stop();
  const finished = vi.fn();
  authorize.mockClear().mockResolvedValue({
    identity: { subject: 'alice', email: 'alice@example.test', displayName: 'Alice' },
    credential: { kind: 'browser', sessionId: 'real-central-sid' },
    expiresAt: Date.now() + 120_000, deadline: performance.now() + 20,
  });
  const disposeMonitor = watchPdlcAuthorization({ key: 'finished', authorize }, finished);
  await Promise.resolve();
  disposeMonitor();
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(finished).not.toHaveBeenCalled();
});

it('expires a lease while Auth is pending and cannot resurrect it with a late proof', async () => {
  const principal = (): PdlcPrincipal => ({
    identity: { subject: 'alice', email: 'alice@example.test', displayName: 'Alice' },
    credential: { kind: 'pat', scopes: ['open-design:write'] },
    expiresAt: Date.now() + 60, deadline: performance.now() + 60,
  });
  let finish!: (value: PdlcPrincipal) => void;
  const authorize = vi.fn(() => new Promise<PdlcPrincipal>(resolve => { finish = resolve; }));
  const revoked = vi.fn();
  const stop = watchPdlcAuthorization({ key: 'slow-owner', authorize, initial: principal() }, revoked);
  await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce(), { interval: 1 });
  expect(revoked).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(revoked).toHaveBeenCalledOnce(), { interval: 1 });
  finish(principal());
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(revoked).toHaveBeenCalledOnce();
  expect(authorize).toHaveBeenCalledOnce();
  stop();
  const valid = vi.fn(async () => principal());
  const neighbor = vi.fn();
  const dispose = watchPdlcAuthorization({ key: 'healthy-owner', authorize: valid }, neighbor, principal());
  await vi.waitFor(() => expect(valid).toHaveBeenCalledOnce(), { interval: 1 });
  expect(neighbor).not.toHaveBeenCalled();
  dispose();
});
