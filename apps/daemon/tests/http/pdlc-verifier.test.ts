import express from 'express';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPdlcVerifier, type PdlcVerifier } from '../../src/http/pdlc-auth.js';

describe('Central Auth verification', () => {
  let server: Server;
  let issuer: string;
  let verify: PdlcVerifier;
  let sign: (overrides?: Record<string, unknown>) => Promise<string>;
  let accessStatus: number;
  let applications: string[];
  let profileSubject: string;

  beforeEach(async () => {
    accessStatus = 200; applications = ['open-design']; profileSubject = 'alice';
    const keys = await generateKeyPair('ES256', { extractable: true });
    const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'ES256' };
    const app = express();
    app.get('/oidc/jwks', (_req, res) => res.json({ keys: [jwk] }));
    app.get('/auth/access', (_req, res) => {
      const now = Date.now();
      res.setHeader('Cache-Control', 'no-store');
      if (accessStatus !== 200) return res.status(accessStatus).json({ error: 'test refusal' });
      return res.json({
        schema_version: 1, issuer, subject: 'alice', role: 'user', applications,
        revision: 1, enforced: true, observed_at: new Date(now).toISOString(),
        expires_at: new Date(now + 60_000).toISOString(),
      });
    });
    app.get('/auth/me', (_req, res) => res.json({
      id: profileSubject, email: 'alice@example.test', display_name: 'Алиса',
    }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    verify = createPdlcVerifier({
      issuer, clientId: 'open-design', publicOrigin: 'https://studio.example',
      hostOrigin: null, catalogUrl: null, applicationKey: 'open-design',
    });
    sign = (overrides = {}) => new SignJWT({
      sub: 'alice', sid: 'central-session', iss: issuer, aud: 'sdlc',
      exp: Math.floor(Date.now() / 1000) + 120, ...overrides,
    }).setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(keys.privateKey);
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('requires a real signature, current app grant and matching live profile', async () => {
    const principal = await verify(await sign());
    expect(principal.identity).toEqual({ subject: 'alice', email: 'alice@example.test', displayName: 'Алиса' });
    expect(principal.deadline).toBeGreaterThan(performance.now());
    expect(principal.deadline - performance.now()).toBeLessThanOrEqual(60_000);
    const other = await generateKeyPair('ES256');
    const forged = await new SignJWT({ sub: 'alice', sid: 'session' })
      .setIssuer(issuer).setAudience('sdlc').setExpirationTime('2m')
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' }).sign(other.privateKey);
    await expect(verify(forged)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects wrong issuer/audience, expiry and a token without a browser session', async () => {
    for (const overrides of [{ iss: 'https://foreign.example' }, { aud: 'another-service' },
      { exp: Math.floor(Date.now() / 1000) - 1 }, { sid: undefined }]) {
      await expect(verify(await sign(overrides))).rejects.toMatchObject({ status: 401 });
    }
  });
  it('does not use a JWT role or an old grant when the owner denies current admission', async () => {
    const token = await sign({ role: 'admin' });
    applications = [];
    await expect(verify(token)).rejects.toMatchObject({ status: 403 });
    applications = ['open-design'];
    expect((await verify(token)).identity.subject).toBe('alice');
    accessStatus = 401;
    await expect(verify(token)).rejects.toMatchObject({ status: 401 });
    accessStatus = 503;
    await expect(verify(token)).rejects.toMatchObject({ status: 503 });
    accessStatus = 404;
    await expect(verify(token)).rejects.toMatchObject({ status: 503 });
  });
  it('refuses a profile belonging to a different subject', async () => {
    profileSubject = 'bob';
    await expect(verify(await sign())).rejects.toMatchObject({ status: 503 });
  });
  it('uses private Auth transport while verifying the public issuer and admission', async () => {
    const privateOrigin = issuer;
    issuer = 'https://login.pdlc.example';
    const verifier = createPdlcVerifier({ issuer, clientId: 'open-design', publicOrigin: 'https://studio.example',
      hostOrigin: null, catalogUrl: null, applicationKey: 'open-design' }, privateOrigin);
    expect((await verifier(await sign())).identity.subject).toBe('alice');
    await expect(verifier(await sign({ iss: privateOrigin }))).rejects.toMatchObject({ status: 401 });
  });
});
