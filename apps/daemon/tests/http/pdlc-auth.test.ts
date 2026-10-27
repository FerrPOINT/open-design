import express from 'express';
import type { Server } from 'node:http';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationAccessError } from '@pdlc/ui/application-access';
import { currentPdlcAuthorization, installPdlcAuth, type PdlcVerifier, type PdlcPreviewAuthorization } from '../../src/http/pdlc-auth.js';
import { createPdlcToolAuthorization } from '../../src/http/pdlc-tool-authorization.js';
import { ToolTokenRegistry, type ToolTokenGrant } from '../../src/tool-tokens.js';
import { pdlcConfiguration } from '../../src/http/pdlc-config.js';
import type { PdlcConfiguration, PdlcSessionResponse } from '@open-design/contracts';

const config: PdlcConfiguration = {
  issuer: 'http://127.0.0.1:19001', clientId: 'open-design',
  publicOrigin: 'http://127.0.0.1:19002', hostOrigin: null,
  catalogUrl: null, applicationKey: 'open-design',
};

describe('PDLC runtime configuration', () => {
  it('keeps standalone only when no platform setting is present', () => {
    expect(pdlcConfiguration({})).toBeNull();
    expect(pdlcConfiguration({ OD_PDLC_AUTH_ISSUER: '', OD_PDLC_CLIENT_ID: '' })).toBeNull();
    expect(() => pdlcConfiguration({ OD_PDLC_HOST_ORIGIN: 'https://host.example' })).toThrow();
  });
  it('rejects credentials, non-loopback HTTP and incomplete configuration', () => {
    const env = {
      OD_PDLC_AUTH_ISSUER: 'https://auth.example', OD_PDLC_CLIENT_ID: 'open-design',
      OD_PDLC_PUBLIC_ORIGIN: 'https://design.example',
    };
    expect(pdlcConfiguration(env)?.applicationKey).toBe('open-design');
    for (const invalid of ['http://design.example', 'https://user:password@design.example',
      'https://design.example/path', 'https://design.example?redirect=foreign']) {
      expect(() => pdlcConfiguration({ ...env, OD_PDLC_PUBLIC_ORIGIN: invalid })).toThrow();
    }
  });
});

describe('PDLC request boundary', () => {
  let server: Server;
  let origin: string;
  let dispose: () => void;
  let revoked = false;
  let available = true;
  let proofLifetime = 60_000;
  let preview: PdlcPreviewAuthorization | null = null;
  const tools = new ToolTokenRegistry();
  const verify = vi.fn<PdlcVerifier>(async (token) => {
    if (!available) throw new ApplicationAccessError(503, 'offline');
    if (revoked || !['alice', 'alice-next', 'bob'].includes(token)) throw new ApplicationAccessError(401, 'revoked');
    const subject = token === 'alice-next' ? 'alice' : token;
    return {
      identity: { subject, email: `${subject}@example.test`, displayName: subject },
      credential: { kind: 'browser' as const, sessionId: `central-${subject}` },
      expiresAt: Date.now() + 120_000, deadline: performance.now() + proofLifetime,
    };
  });

  beforeEach(async () => {
    revoked = false; available = true; proofLifetime = 60_000; preview = null; verify.mockClear();
    const app = express();
    ({ dispose } = installPdlcAuth(app, config, verify,
      (req) => req.path === '/api/projects/local/preview/capability/result.html' ? preview : null,
      createPdlcToolAuthorization(tools)));
    app.get(['/api/projects', '/artifacts/result.html', '/frames/demo', '/mcp',
      '/api/projects/local/preview/capability/result.html'], (_req, res) => {
      res.json({ subject: res.locals.pdlc.identity.subject });
    });
    app.post('/api/projects', (_req, res) => res.json({ ok: true }));
    app.post('/api/test-preview', (_req, res) => {
      preview = res.locals.pdlcPreview;
      res.json({ ok: true });
    });
    app.post('/api/test-tool', async (_req, res) => {
      await Promise.resolve();
      const grant = tools.mint({ runId: 'fixture-run', projectId: 'local',
        allowedEndpoints: ['/api/tools/library/search'],
        authorization: currentPdlcAuthorization() ?? undefined });
      res.json(grant);
    });
    app.post('/api/tools/library/search', (_req, res) => res.json({ subject: res.locals.pdlc.identity.subject }));
    app.get('/api/events', (_req, res) => {
      res.type('text/event-stream');
      res.write('data: ready\n\n');
    });
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    dispose();
    tools.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function login(token = 'alice', cookie?: string) {
    return fetch(origin + '/api/pdlc/session', {
      method: 'POST', headers: { Origin: config.publicOrigin, Authorization: `Bearer ${token}`,
        ...(cookie ? { Cookie: cookie } : {}) },
    });
  }
  function cookieOf(response: Response) {
    return response.headers.get('set-cookie')!.split(';')[0]!;
  }

  it('publishes only public config and keeps health public', async () => {
    expect(await (await fetch(origin + '/api/pdlc/config')).json()).toEqual(config);
    expect((await fetch(origin + '/api/health')).status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
  });
  it('applies the canonical shared theme in bootstrap before the studio can mount', async () => {
    const response = await fetch(origin + '/api/pdlc/bootstrap.js');
    const attributes = new Map<string, string>();
    const context = { window: {} as Record<string, unknown>, document: {
      cookie: 'sdlc-ui-theme=gray',
      documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
    } };
    runInNewContext(await response.text(), context);
    expect(context.window.__OD_PDLC_CONFIG__).toEqual(config);
    expect(attributes.get('data-theme')).toBe('gray');
    expect(attributes.has('data-pdlc')).toBe(true);
  });
  it.each(['/api/projects', '/artifacts/result.html', '/frames/demo', '/mcp'])(
    'rejects unauthenticated direct and loopback requests to %s', async (path) => {
      expect((await fetch(origin + path)).status).toBe(401);
      expect((await fetch(origin + path, { headers: { Authorization: 'Basic shared-token' } })).status).toBe(401);
      expect((await fetch(origin + path, { headers: { Authorization: 'Bearer alice' } })).status).toBe(200);
    },
  );
  it('creates an opaque HttpOnly binding and admits headerless EventSource/assets', async () => {
    const response = await login();
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie')!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('alice');
    const cookie = cookieOf(response);
    expect((await fetch(origin + '/artifacts/result.html', { headers: { Cookie: cookie } })).status).toBe(200);
    const data = await (await fetch(origin + '/api/pdlc/session', { headers: { Cookie: cookie } })).json() as PdlcSessionResponse;
    expect(data.identity.subject).toBe('alice');
    expect(verify).toHaveBeenCalledTimes(3);
  });
  it('does not fall back from an explicit invalid bearer to a valid binding', async () => {
    const cookie = cookieOf(await login());
    expect((await fetch(origin + '/api/projects', {
      headers: { Cookie: cookie, Authorization: 'Bearer invalid' },
    })).status).toBe(401);
    expect((await fetch(origin + '/api/projects', { headers: { Cookie: cookie } })).status).toBe(200);
  });
  it('rejects cross-origin and sandboxed-HTML mutations but permits exact-origin writes', async () => {
    const cookie = cookieOf(await login());
    for (const foreign of [undefined, 'null', 'https://other.example']) {
      expect((await fetch(origin + '/api/projects', {
        method: 'POST', headers: { Cookie: cookie, ...(foreign ? { Origin: foreign } : {}) },
      })).status).toBe(403);
    }
    expect((await fetch(origin + '/api/projects', {
      method: 'POST', headers: { Cookie: cookie, Origin: config.publicOrigin },
    })).status).toBe(200);
    expect((await fetch(origin + '/api/pdlc/session', {
      method: 'POST', headers: { Origin: 'https://other.example', Authorization: 'Bearer alice' },
    })).status).toBe(403);
  });
  it('does not interpret Cloud workspace claims as platform authority', async () => {
    expect((await fetch(origin + '/api/projects?workspaceId=other&workspaceMemberId=other', {
      headers: { Authorization: 'Bearer alice' },
    })).status).toBe(403);
    expect((await fetch(origin + '/api/projects', {
      headers: { Authorization: 'Bearer alice', 'x-od-workspace-id': 'other' },
    })).status).toBe(403);
  });
  it('keeps the process-wide Cloud identity out of the platform workspace context', async () => {
    const headers = { Authorization: 'Bearer alice' };
    expect(await (await fetch(origin + '/api/workspace/context', { headers })).json()).toEqual({ context: null });
    expect(await (await fetch(origin + '/api/workspace/directory', { headers })).json()).toEqual({ items: [], activeWorkspaceId: null });
    expect((await fetch(origin + '/api/integrations/vela/status', { headers })).status).toBe(403);
    expect((await fetch(origin + '/api/workspace/projects/team', { headers })).status).toBe(403);
    expect((await fetch(origin + '/api/projects', { headers })).status).toBe(200);
  });
  it('admits only the exact delegated preview and revokes it with its browser binding', async () => {
    const cookie = cookieOf(await login());
    await fetch(origin + '/api/test-preview', {
      method: 'POST', headers: { Cookie: cookie, Origin: config.publicOrigin },
    });
    const url = '/api/projects/local/preview/capability/result.html';
    expect((await fetch(origin + url, { headers: { Origin: 'null' } })).status).toBe(200);
    expect((await fetch(origin + '/api/projects/other/preview/capability/result.html', {
      headers: { Origin: 'null' },
    })).status).toBe(403);
    expect((await fetch(origin + url, { method: 'POST', headers: { Origin: 'null' } })).status).toBe(403);
    await fetch(origin + '/api/pdlc/logout', {
      method: 'POST', headers: { Cookie: cookie, Origin: config.publicOrigin },
    });
    expect((await fetch(origin + url, { headers: { Origin: 'null' } })).status).toBe(401);
  });
  it('rotates identity and revokes the previous opaque handle on account replacement', async () => {
    const previous = cookieOf(await login());
    const replaced = await login('bob', previous);
    expect((await replaced.json() as PdlcSessionResponse).identityChanged).toBe(true);
    const next = cookieOf(replaced);
    expect((await fetch(origin + '/api/projects', { headers: { Cookie: previous } })).status).toBe(401);
    const result = await (await fetch(origin + '/api/projects', { headers: { Cookie: next } })).json() as { subject: string };
    expect(result.subject).toBe('bob');
  });
  it('preserves the binding and delegated previews during a refresh of the same central session', async () => {
    const cookie = cookieOf(await login());
    await fetch(origin + '/api/test-preview', {
      method: 'POST', headers: { Cookie: cookie, Origin: config.publicOrigin },
    });
    const refreshed = await login('alice-next', cookie);
    expect(cookieOf(refreshed)).toBe(cookie);
    expect((await refreshed.json() as PdlcSessionResponse).identityChanged).toBe(false);
    const url = '/api/projects/local/preview/capability/result.html';
    expect((await fetch(origin + url, { headers: { Origin: 'null' } })).status).toBe(200);
    expect(verify).toHaveBeenLastCalledWith('alice-next');
  });
  it('carries initiating identity into async run capabilities without a privileged loopback exception', async () => {
    const cookie = cookieOf(await login());
    const created = await fetch(origin + '/api/test-tool', {
      method: 'POST', headers: { Cookie: cookie, Origin: config.publicOrigin },
    });
    const grant = await created.json() as ToolTokenGrant;
    expect(grant).not.toHaveProperty('authorization');
    const headers = { Authorization: `Bearer ${grant.token}` };
    const allowed = await fetch(origin + '/api/tools/library/search', { method: 'POST', headers });
    expect(await allowed.json()).toEqual({ subject: 'alice' });
    expect((await fetch(origin + '/api/projects', { headers })).status).toBe(401);
    await fetch(origin + '/api/pdlc/logout', {
      method: 'POST', headers: { Cookie: cookie, Origin: config.publicOrigin },
    });
    expect((await fetch(origin + '/api/tools/library/search', { method: 'POST', headers })).status).toBe(401);
  });
  it('distinguishes Auth outage from revocation and keeps the transport recoverable', async () => {
    const cookie = cookieOf(await login());
    available = false;
    expect((await fetch(origin + '/api/projects', { headers: { Cookie: cookie } })).status).toBe(503);
    available = true;
    expect((await fetch(origin + '/api/projects', { headers: { Cookie: cookie } })).status).toBe(200);
    revoked = true;
    expect((await fetch(origin + '/api/projects', { headers: { Cookie: cookie } })).status).toBe(401);
  });
  it('logout revokes the handle and terminates its active streams', async () => {
    const cookie = cookieOf(await login());
    const stream = await fetch(origin + '/api/events', {
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(3000),
    });
    const reader = stream.body!.getReader();
    await reader.read();
    const pending = reader.read();
    const failure = expect(pending).rejects.toThrow();
    const logout = await fetch(origin + '/api/pdlc/logout', {
      method: 'POST', headers: { Cookie: cookie, Origin: config.publicOrigin },
    });
    expect(logout.status).toBe(204);
    await failure;
    expect((await fetch(origin + '/api/projects', { headers: { Cookie: cookie } })).status).toBe(401);
  });
  it('rechecks an open stream when the owner proof expires', async () => {
    proofLifetime = 100;
    const cookie = cookieOf(await login());
    const stream = await fetch(origin + '/api/events', {
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(3000),
    });
    const reader = stream.body!.getReader();
    await reader.read();
    revoked = true;
    await expect(reader.read()).rejects.toThrow();
    expect(verify.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
