import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Express, NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  ApplicationAccessError, confirmApplicationAccess, permitsApplication,
} from '@pdlc/ui/application-access';
import type { PdlcConfiguration, PdlcIdentity, WorkspaceDirectoryResponse } from '@open-design/contracts';
import { pdlcAuthOrigin } from './pdlc-config.js';

export interface PdlcPrincipal {
  identity: PdlcIdentity;
  credential: { kind: 'browser'; sessionId: string } | { kind: 'pat'; scopes: readonly string[] };
  expiresAt: number;
  /** Monotonic owner-proof deadline, bounded by Central Auth and JWT expiry. */
  deadline: number;
}

export type PdlcVerifier = (token: string) => Promise<PdlcPrincipal>;
export interface PdlcPreviewAuthorization {
  readonly key: string;
  readonly authorize: () => Promise<PdlcPrincipal>;
}

/** A background run cannot retain authority after its initiating proof expires. */
export function watchPdlcAuthorization(authority: PdlcPreviewAuthorization, revoked: () => void,
  initial?: PdlcPrincipal): () => void {
  let closed = false;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => { closed = true; clearTimeout(renewal); clearTimeout(expiry); };
  const deny = () => { if (!closed) { dispose(); revoked(); } };
  const accept = (principal: PdlcPrincipal) => {
    if (closed) return;
    const remaining = principal.deadline - performance.now();
    if (remaining <= 0) { deny(); return; }
    clearTimeout(renewal); clearTimeout(expiry);
    // Renew before the lease ends, but never extend it while Auth is pending.
    expiry = setTimeout(deny, remaining);
    renewal = setTimeout(() => { void check(); }, Math.max(1, remaining - Math.min(5000, remaining / 2)));
    expiry.unref(); renewal.unref();
  };
  const check = async () => {
    try { accept(await authority.authorize()); }
    catch { deny(); }
  };
  if (initial) accept(initial); else void check();
  return dispose;
}
const requestAuthorization = new AsyncLocalStorage<PdlcPreviewAuthorization>();
/** Server-created runs inherit the initiating request's authority, never analytics identity. */
export function currentPdlcAuthorization(): PdlcPreviewAuthorization | null {
  return requestAuthorization.getStore() ?? null;
}

export class PdlcAuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function authStatus(error: unknown): number {
  const status = error instanceof PdlcAuthError || error instanceof ApplicationAccessError ? error.status : 503;
  return [401, 403, 429].includes(status) ? status : 503;
}

/** Central Auth remains the sole credential, session and application-access owner. */
export function createPdlcVerifier(config: PdlcConfiguration, internalOrigin = process.env.OD_PDLC_AUTH_INTERNAL_ORIGIN): PdlcVerifier {
  const authOrigin = pdlcAuthOrigin(internalOrigin, config.issuer);
  const jwks = createRemoteJWKSet(new URL('/oidc/jwks', authOrigin));
  return async (token) => {
    if (/^(?:pdlc|sdlc)_pat_/.test(token)) return verifyPersonalToken(config, token, authOrigin);
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(token, jwks, {
        issuer: config.issuer, audience: 'sdlc', algorithms: ['ES256'],
        requiredClaims: ['sub', 'exp', 'sid'],
      }));
    } catch (error) {
      // Transport/JWKS outages must not be mistaken for a signed-out account.
      const code = (error as { code?: string }).code;
      const invalid = code && ['ERR_JWT_EXPIRED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
        'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWS_INVALID', 'ERR_JWT_INVALID',
        'ERR_JOSE_ALG_NOT_ALLOWED'].includes(code);
      throw new PdlcAuthError(invalid ? 401 : 503, 'Не удалось проверить вход PDLC.');
    }
    if (typeof claims.sub !== 'string' || !claims.sub ||
      typeof claims.sid !== 'string' || !claims.sid) {
      throw new PdlcAuthError(401, 'Некорректная браузерная identity PDLC.');
    }
    const subject = claims.sub;
    const expiresAt = claims.exp! * 1000;
    const startedAt = performance.now();
    const decision = await ownerJson(authOrigin, '/auth/access', token);
    const access = confirmApplicationAccess(decision, { issuer: config.issuer, subject,
      startedAt, receivedAt: performance.now(), wallAtReceipt: Date.now(), tokenExpiresAt: expiresAt });
    if (!permitsApplication(access, [config.applicationKey])) {
      throw new PdlcAuthError(403, 'Нет доступа к OpenDesign.');
    }
    const response = await fetch(new URL('/auth/me', authOrigin), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Cache-Control': 'no-store' },
      credentials: 'omit', redirect: 'error',
      signal: AbortSignal.timeout(5000),
    }).catch(() => { throw new PdlcAuthError(503, 'Central Auth недоступен.'); });
    if (!response.ok) {
      throw new PdlcAuthError([401, 403, 429].includes(response.status) ? response.status : 503,
        'Не удалось подтвердить аккаунт PDLC.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new PdlcAuthError(503, 'Пустой профиль PDLC.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 16384) throw new PdlcAuthError(503, 'Некорректный профиль PDLC.');
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    let profile;
    try { profile = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new PdlcAuthError(503, 'Некорректный профиль PDLC.'); }
    if (profile.id !== subject || typeof profile.email !== 'string' ||
      typeof profile.display_name !== 'string' || !profile.display_name.trim()) {
      throw new PdlcAuthError(503, 'Профиль PDLC не соответствует проверенной identity.');
    }
    if (access.deadline <= performance.now()) {
      throw new PdlcAuthError(503, 'Подтверждение доступа истекло при загрузке профиля.');
    }
    return {
      identity: { subject, email: profile.email, displayName: profile.display_name },
      credential: { kind: 'browser', sessionId: claims.sid },
      expiresAt, deadline: access.deadline,
    };
  };
}

/** Introspection authenticates opaque PATs and supplies current admission and lifetime. */
async function verifyPersonalToken(config: PdlcConfiguration, token: string, authOrigin: string): Promise<PdlcPrincipal> {
  const startedAt = performance.now();
  const value = await ownerJson(authOrigin, '/auth/tokens/introspect?include_lifetime=true', token);
  if (typeof value.sub !== 'string' || !value.sub.trim() || typeof value.email !== 'string' ||
    typeof value.display_name !== 'string' || !value.display_name.trim() ||
    !Array.isArray(value.scopes) || !value.scopes.every((scope: unknown) => typeof scope === 'string') ||
    value.subject_role === 'service_account' || value.role === 'service_account') {
    throw new PdlcAuthError(503, 'Invalid introspection identity');
  }
  const expiresAt = Date.parse(value.expires_at), observed = Date.parse(value.observed_at);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(observed) || observed > Date.now() + 5000) {
    throw new PdlcAuthError(503, 'Invalid introspection lifetime');
  }
  if (expiresAt <= Date.now() || expiresAt <= observed) throw new PdlcAuthError(401, 'PAT expired');
  const access = confirmApplicationAccess(value.application_access, {
    issuer: config.issuer, subject: value.sub, startedAt, receivedAt: performance.now(),
    wallAtReceipt: Date.now(), tokenExpiresAt: expiresAt,
  });
  if (!permitsApplication(access, [config.applicationKey])) throw new PdlcAuthError(403, 'Application denied');
  return { identity: { subject: value.sub, email: value.email, displayName: value.display_name },
    credential: { kind: 'pat', scopes: value.scopes }, expiresAt, deadline: access.deadline };
}

async function ownerJson(origin: string, path: string, token: string) {
  const url = new URL(path, origin);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(5000),
  }).catch(() => { throw new PdlcAuthError(503, 'Central Auth недоступен.'); });
  if (!response.ok) {
    await response.body?.cancel();
    throw new PdlcAuthError([401, 403, 429].includes(response.status) ? response.status : 503, 'PAT verification failed');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PdlcAuthError(503, 'Empty introspection');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 16384) throw new PdlcAuthError(503, 'Invalid introspection');
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PdlcAuthError(503, 'Invalid introspection'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PdlcAuthError(503, 'Invalid owner response');
  return value;
}

/** PAT permissions follow the operation; explicitly listed POST queries have no effects. */
function requireOperation(value: PdlcPrincipal, req: Pick<Request, 'method' | 'path'>): void {
  if (value.credential.kind !== 'pat') return;
  const read = safeMethods.has(req.method) || (req.method === 'POST' &&
    ['/api/tools/library/search'].includes(req.path));
  if (!value.credential.scopes.includes(`open-design:${read ? 'read' : 'write'}`)) {
    throw new PdlcAuthError(403, 'Missing operation scope');
  }
}

interface Binding {
  token: string;
  subject: string;
  sessionId: string;
  expiresAt: number;
  responses: Set<Response>;
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const probes = new Set(['/health', '/ready', '/version', '/api/health', '/api/ready', '/api/version']);

/**
 * An opaque, process-local transport binding supports native EventSource/assets.
 * It never issues identity or refresh tokens: each admission verifies the original
 * bearer with Central Auth. Restart requires PKCE restoration, not a second login DB.
 */
export function installPdlcAuth(
  app: Express,
  config: PdlcConfiguration,
  verify: PdlcVerifier = createPdlcVerifier(config),
  previewAuthorization: (req: Request) => PdlcPreviewAuthorization | null = () => null,
  toolAuthorization: (req: Request) => PdlcPreviewAuthorization | null = () => null,
): { dispose(): void } {
  const bindings = new Map<string, Binding>();
  const secure = new URL(config.publicOrigin).protocol === 'https:';
  const cookieName = `${secure ? '__Host-' : ''}od_pdlc_${createHash('sha256')
    .update(config.issuer + '\n' + config.publicOrigin).digest('hex')}`;
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  const themeRuntime = readFileSync(fileURLToPath(import.meta.resolve('@pdlc/ui/theme-preference')), 'utf8');

  app.use((req, res, next) => {
    const incomingId = req.get('x-request-id') ?? '';
    const requestId = /^[A-Za-z0-9_.:-]{1,128}$/.test(incomingId) ? incomingId : randomUUID();
    res.setHeader('X-Request-ID', requestId);
    res.locals.requestId = requestId;
    // The studio shell may be embedded only by its configured Base host.
    // Generated data keeps the stronger sandbox policies owned by its routes.
    if (!/^\/(?:api|artifacts|frames|mcp)(?:\/|$)/.test(req.path)) {
      res.setHeader('Content-Security-Policy', `frame-ancestors 'self'${config.hostOrigin ? ` ${config.hostOrigin}` : ''}`);
    }
    next();
  });

  app.get('/api/pdlc/bootstrap.js', (_req, res) => {
    const serialized = JSON.stringify(config).replaceAll('<', '\\u003c');
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/javascript').send(`window.__OD_PDLC_CONFIG__=${serialized};\n${themeRuntime}\n` +
      `document.documentElement.setAttribute('data-pdlc','');` +
      `document.documentElement.setAttribute('data-theme',window.PdlcThemePreference.read());`);
  });

  function handle(req: Request): string | null {
    const cookies = (req.headers.cookie ?? '').split(';').map((part) => part.trim());
    const matches = cookies.filter((part) => part.startsWith(cookieName + '='));
    if (matches.length !== 1) return null;
    const value = matches[0]!.slice(cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  function revoke(key: string | null) {
    if (!key) return;
    const binding = bindings.get(key);
    bindings.delete(key);
    for (const response of binding?.responses ?? []) response.destroy();
  }
  function fail(res: Response, error: unknown) {
    const status = authStatus(error);
    return res.status(status).json({ error: {
      code: `PDLC_${status === 401 ? 'LOGIN_REQUIRED' : status === 403 ? 'ACCESS_DENIED' : 'AUTH_UNAVAILABLE'}`,
      message: status === 401 ? 'Требуется вход PDLC.' : status === 403
        ? 'Нет доступа к OpenDesign.' : 'Не удалось проверить доступ PDLC.',
      requestId: res.locals.requestId,
    } });
  }
  function sameOrigin(req: Request) {
    return req.get('origin') === config.publicOrigin;
  }
  function tokenFrom(req: Request): string | null {
    const authorization = req.get('authorization');
    // An explicit invalid credential must not fall back to a cookie.
    if (authorization !== undefined) return /^Bearer ([^\s]{1,16384})$/.exec(authorization)?.[1] ?? null;
    const binding = bindings.get(handle(req) ?? '');
    if (!binding || binding.expiresAt <= Date.now()) return null;
    return binding.token;
  }
  async function principal(req: Request) {
    const token = tokenFrom(req);
    if (!token) throw new PdlcAuthError(401, 'Требуется вход PDLC.');
    return verify(token);
  }

  app.get('/api/pdlc/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(config);
  });
  app.post('/api/pdlc/logout', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!sameOrigin(req)) return fail(res, new PdlcAuthError(403, 'Invalid origin'));
    revoke(handle(req));
    res.clearCookie(cookieName, cookieOptions);
    return res.status(204).end();
  });
  app.post('/api/pdlc/session', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!sameOrigin(req)) return fail(res, new PdlcAuthError(403, 'Invalid origin'));
    if (!req.get('authorization')) return fail(res, new PdlcAuthError(401, 'Bearer required'));
    try {
      const value = await principal(req);
      if (value.credential.kind !== 'browser') throw new PdlcAuthError(403, 'Browser credential required');
      // Remove expired handles on allocation; no global cleanup worker is needed.
      for (const [key, binding] of bindings) if (binding.expiresAt <= Date.now()) revoke(key);
      const previous = handle(req);
      const previousBinding = bindings.get(previous ?? '');
      const previousSubject = previousBinding?.subject;
      if (bindings.size >= 1000 && !bindings.has(previous ?? '')) {
        throw new PdlcAuthError(429, 'Too many active browser bindings');
      }
      const sameSession = previousBinding?.subject === value.identity.subject &&
        previousBinding.sessionId === value.credential.sessionId;
      const key = sameSession ? previous! : randomBytes(32).toString('hex');
      const token = tokenFrom(req)!;
      if (sameSession) {
        // PKCE refresh within the same central SID must not invalidate live runs
        // and previews. Authority changes only when session/subject changes.
        previousBinding.token = token;
        previousBinding.expiresAt = value.expiresAt;
      } else {
        revoke(previous);
        bindings.set(key, { token, subject: value.identity.subject, sessionId: value.credential.sessionId,
          expiresAt: value.expiresAt, responses: new Set() });
      }
      res.cookie(cookieName, key, { ...cookieOptions, maxAge: Math.max(0, value.expiresAt - Date.now()) });
      return res.json({ identity: value.identity, expiresAt: value.expiresAt,
        identityChanged: previousSubject !== undefined && previousSubject !== value.identity.subject });
    } catch (error) { return fail(res, error); }
  });

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const protectedPath = /^\/(?:api|artifacts|frames|mcp)(?:\/|$)/.test(req.path);
    if (!protectedPath || (safeMethods.has(req.method) && probes.has(req.path))) return next();
    res.setHeader('Cache-Control', 'no-store');
    const preview = ['GET', 'HEAD'].includes(req.method) ? previewAuthorization(req) : null;
    const delegated = preview ?? toolAuthorization(req);
    // Cookie-authenticated mutations require the exact product origin. Sandboxed
    // generated HTML (Origin: null) cannot act as the authenticated studio.
    if (!preview && ((!safeMethods.has(req.method) && !sameOrigin(req) && !req.get('authorization')) ||
      (req.get('origin') !== undefined && !sameOrigin(req)))) {
      return fail(res, new PdlcAuthError(403, 'Invalid origin'));
    }
    const key = handle(req);
    const binding = req.get('authorization') === undefined ? bindings.get(key ?? '') : undefined;
    const token = tokenFrom(req);
    const operation = { method: req.method, path: req.path };
    // Do not retain Request in a reusable preview capability: parsers may later
    // attach very large uploads to it. Capture only the credential and binding.
    const authorize = delegated?.authorize ?? (async () => {
      if (!token || (binding && bindings.get(key!) !== binding)) {
        throw new PdlcAuthError(401, 'Требуется вход PDLC.');
      }
      const fresh = await verify(binding?.token ?? token);
      requireOperation(fresh, operation);
      return fresh;
    });
    try {
      const value = await authorize();
      requireOperation(value, req);
      const requestId = res.locals.requestId as string;
      const startedAt = performance.now();
      res.once('finish', () => console.info(JSON.stringify({ event: 'pdlc.request', requestId,
        subject: value.identity.subject, credential: value.credential.kind, method: operation.method,
        route: typeof req.route?.path === 'string' ? req.route.path : '/:protected',
        status: res.statusCode, durationMs: Math.round(performance.now() - startedAt) })));
      res.locals.pdlc = value;
      res.locals.pdlcPreview = delegated ?? {
        key: key ?? createHash('sha256').update(token!).digest('hex'), authorize,
      } satisfies PdlcPreviewAuthorization;
      // Upstream Cloud's process-wide Vela credential is not the browser's
      // platform identity. Do not accept routing claims as Cloud membership.
      if (req.get('x-od-workspace-id') || req.get('x-od-workspace-member-id') ||
        req.get('x-od-app-user-id') || req.query.workspaceId || req.query.workspaceMemberId) {
        throw new PdlcAuthError(403, 'Cloud identity is not a PDLC identity');
      }
      if (req.path === '/api/pdlc/session' && req.method === 'GET') {
        return res.json({ identity: value.identity, expiresAt: value.expiresAt });
      }
      if (req.path === '/api/workspace/context' && req.method === 'GET') {
        // Local studio mode has no browser-bound Vela principal. Returning the
        // daemon's process-wide Cloud account here would misidentify every user.
        return res.json({ context: null });
      }
      if (req.path === '/api/workspace/directory' && req.method === 'GET') {
        // Cloud identity is absent, not rejected: a 403 here would make the
        // existing shell redirect every local project back to Cloud onboarding.
        return res.json({ items: [], activeWorkspaceId: null } satisfies WorkspaceDirectoryResponse);
      }
      if (/^\/api\/(?:workspace(?:\/|$)|integrations\/vela(?:\/|$)|amr(?:\/|$))/.test(req.path)) {
        return res.status(403).json({ error: { code: 'PDLC_CLOUD_IDENTITY_REQUIRED',
          message: 'OpenDesign Cloud требует отдельной привязки identity; локальная студия доступна через PDLC.' } });
      }
      // Track long-lived responses through their actual lifecycle. Owner proofs
      // expire in at most 60s; an open stream cannot outlive revoked admission.
      binding?.responses.add(res);
      const dispose = watchPdlcAuthorization(res.locals.pdlcPreview, () => res.destroy(), value);
      res.once('close', () => { dispose(); binding?.responses.delete(res); });
      return requestAuthorization.run(res.locals.pdlcPreview, next);
    } catch (error) {
      if (!req.get('authorization') &&
        (error instanceof PdlcAuthError || error instanceof ApplicationAccessError) && error.status === 401) {
        revoke(key);
        res.clearCookie(cookieName, cookieOptions);
      }
      return fail(res, error);
    }
  });
  return { dispose() { for (const key of bindings.keys()) revoke(key); } };
}
