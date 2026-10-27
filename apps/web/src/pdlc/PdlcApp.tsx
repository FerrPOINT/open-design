'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Router, type Navigator, type To } from 'react-router';
import {
  ApplicationAccessProvider, RequireApplicationAccess,
} from '@pdlc/ui/auth';
import {
  applySsoSession, beginSso, completeSso, endSso, isSsoLoginRequired,
  isSsoNavigationInterruption, relaySsoCallback, restoreSso, type SsoConfig,
} from '@pdlc/ui/sso';
import { ThemeProvider } from '@pdlc/ui/lib';
import { pdlcLocales } from '@pdlc/ui/i18n';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  ErrorState, LoadingState, PlatformHeader, PlatformLogin, PlatformMark,
  PlatformServicesProvider, ThemeMenuItems,
} from '@pdlc/ui/ui';
import {
  capturePlatformReturn, connectPlatformProduct, finishPlatformLogin, getPlatformProduct,
} from '@pdlc/ui/platform';
import type { PdlcConfiguration, PdlcIdentity, PdlcSessionResponse } from '@open-design/contracts';
import { App } from '../App';
import { confirmProductLeave, navigatePath, useRoute } from '../router';

const boundaryKey = 'open-design:pdlc-session-boundary';
const labels = createInstance();
void labels.init({ lng: 'ru', fallbackLng: 'ru', resources: {
  en: { translation: pdlcLocales.en }, ru: { translation: pdlcLocales.ru },
}, initAsync: false, interpolation: { escapeValue: false } });

class SessionError extends Error {
  constructor(readonly status: number) { super('Не удалось подтвердить вход OpenDesign.'); }
}

async function bindSession(token: string): Promise<PdlcSessionResponse> {
  const response = await fetch('/api/pdlc/session', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store', credentials: 'same-origin', redirect: 'error',
  });
  if (!response.ok) throw new SessionError(response.status);
  return response.json() as Promise<PdlcSessionResponse>;
}

function returnPath() {
  return ['/login', '/sso/callback'].includes(window.location.pathname)
    ? '/' : window.location.pathname + window.location.search + window.location.hash;
}

function platformRouter(): Navigator {
  const href = (to: To) => typeof to === 'string' ? to
    : (to.pathname ?? '/') + (to.search ?? '') + (to.hash ?? '');
  return {
    createHref: href,
    go: (delta) => window.history.go(delta),
    push: (to) => navigatePath(href(to)),
    replace: (to) => navigatePath(href(to), { replace: true }),
  };
}

export function PdlcApp() {
  const [configuration, setConfiguration] = useState<PdlcConfiguration | null | undefined>(window.__OD_PDLC_CONFIG__);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    void fetch('/api/pdlc/config', { cache: 'no-store', redirect: 'error' }).then(async (response) => {
      if (!response.ok) throw new Error('Configuration unavailable');
      const value = await response.json() as PdlcConfiguration | null;
      window.__OD_PDLC_CONFIG__ = value;
      if (value) document.documentElement.setAttribute('data-pdlc', '');
      setConfiguration(value);
    }).catch(() => setError(true));
  }, []);
  useEffect(() => { if (configuration === undefined) load(); }, [configuration, load]);
  if (configuration === null) return <App />;
  return <I18nextProvider i18n={labels}><ThemeProvider>
    {error ? <ErrorState message="Не удалось загрузить конфигурацию OpenDesign." onRetry={load} />
      : configuration === undefined ? <LoadingState /> : <PlatformStudio config={configuration} />}
  </ThemeProvider></I18nextProvider>;
}

function PlatformStudio({ config }: { config: PdlcConfiguration }) {
  const sso = useMemo<SsoConfig>(() => ({ issuer: config.issuer, clientId: config.clientId, namespace: 'pdlc' }), [config]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [ending, setEnding] = useState(false);
  const [authenticated, setAuthenticated] = useState<{ token: string; identity: PdlcIdentity } | null>(null);
  const token = authenticated?.token ?? null;
  const name = authenticated?.identity.displayName;
  const email = authenticated?.identity.email;
  const subject = useRef<string | null>(null);
  const generation = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  useRoute(); // The existing router is the only owner of the product location.
  const navigator = useMemo(platformRouter, []);

  const clearLocal = useCallback(() => {
    generation.current++;
    setAuthenticated(null);
    setPhase('login');
  }, []);
  const signedOut = useCallback(() => {
    clearLocal();
    getPlatformProduct()?.readiness({ ready: false, error: null });
    getPlatformProduct()?.requireLogin(returnPath());
  }, [clearLocal]);

  useEffect(() => {
    const product = connectPlatformProduct({ serviceKey: config.applicationKey,
      ...(config.hostOrigin ? { portalOrigin: config.hostOrigin } : {}) });
    capturePlatformReturn(config.hostOrigin ?? undefined);
    const removeGuard = product?.addLeaveGuard(confirmProductLeave);
    const retire = product?.onRetire(clearLocal);
    return () => { removeGuard?.(); retire?.(); };
  }, [config, clearLocal]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const current = new BroadcastChannel('open-design:pdlc-logout');
    channel.current = current;
    current.onmessage = (event) => {
      if (event.data !== 'logout' && event.data !== 'identity-changed') return;
      clearLocal();
      getPlatformProduct()?.readiness({ ready: false, error: null });
      if (event.data === 'identity-changed') window.location.reload();
    };
    return () => { current.close(); channel.current = null; };
  }, [clearLocal]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== boundaryKey || !subject.current) return;
      let kind: unknown;
      try { kind = JSON.parse(event.newValue ?? 'null')?.kind; }
      catch { return; }
      if (kind !== 'logout' && kind !== 'identity-changed') return;
      // Invalidation only. Profiles/tokens never enter cross-document storage,
      // and a receiver never republishes a boundary back to the sending tab.
      clearLocal();
      getPlatformProduct()?.readiness({ ready: false, error: null });
      if (kind === 'identity-changed') window.location.reload();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [clearLocal]);

  const publishBoundary = (kind: 'logout' | 'identity-changed') => {
    channel.current?.postMessage(kind);
    try { localStorage.setItem(boundaryKey, JSON.stringify({ kind, nonce: crypto.randomUUID() })); }
    catch { /* BroadcastChannel remains available when browser storage is blocked. */ }
  };

  useEffect(() => {
    const attempt = ++generation.current;
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    async function restore() {
      if (!active || attempt !== generation.current) return;
      try {
        const callback = window.location.pathname === '/sso/callback';
        if (callback && relaySsoCallback('pdlc')) return;
        const session = callback ? await completeSso(sso) : await restoreSso(sso, returnPath());
        if (!active || attempt !== generation.current) return;
        const bound = await bindSession(session.accessToken);
        if (!active || attempt !== generation.current) return;
        if (bound.identity.subject !== session.subject) throw new SessionError(503);
        if (bound.identityChanged) publishBoundary('identity-changed');
        if (subject.current && subject.current !== bound.identity.subject) {
          // A document boundary discards all upstream module caches and late reads.
          window.location.reload();
          return;
        }
        applySsoSession(session, () => {
          subject.current = bound.identity.subject;
          setAuthenticated({ token: session.accessToken, identity: bound.identity });
        });
        if (callback) {
          if (finishPlatformLogin(config.hostOrigin ?? undefined)) return;
          window.history.replaceState(window.history.state, '', session.returnTo);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
        setPhase('ready'); setError(null);
        // Refresh through the canonical silent PKCE flow, never a local refresh issuer.
        refreshTimer = setTimeout(() => void restore(), Math.max(1000, session.expiresAt - Date.now() - 30_000));
      } catch (cause) {
        if (!active || attempt !== generation.current || isSsoNavigationInterruption(cause)) return;
        if (isSsoLoginRequired(cause) || (cause instanceof SessionError && cause.status === 401)) signedOut();
        else {
          setAuthenticated(null);
          const message = cause instanceof SessionError && cause.status === 403
            ? 'Нет доступа к OpenDesign.' : 'Не удалось проверить доступ. Повторите попытку.';
          setError(message); setPhase('error');
          getPlatformProduct()?.readiness({ ready: false, error: message });
        }
      }
    }
    void restore();
    return () => { active = false; clearTimeout(refreshTimer); };
  }, [sso, config.hostOrigin, nonce, signedOut]);

  const login = () => {
    if (ending) return;
    setError(null);
    void beginSso(sso, returnPath(), { interactive: true }).catch((cause) => {
      if (!isSsoNavigationInterruption(cause)) setError('Не удалось открыть вход PDLC.');
    });
  };
  const logout = async () => {
    if (ending || !await confirmProductLeave()) return;
    setEnding(true);
    clearLocal();
    getPlatformProduct()?.readiness({ ready: false, error: null });
    publishBoundary('logout');
    try {
      await fetch('/api/pdlc/logout', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000) });
    } catch {
      // Central Auth owns revocation. A local outage must not trap the user in
      // the shared session; every retained binding still checks that owner.
    }
    try { endSso(sso); }
    catch { setEnding(false); setError('Не удалось открыть выход PDLC. Повторите попытку.'); }
  };
  return <Router location={window.location.pathname + window.location.search + window.location.hash} navigator={navigator}>
    <ApplicationAccessProvider issuer={config.issuer} token={phase === 'ready' ? token : null}
      onSessionExpired={signedOut}>
    <PlatformServicesProvider catalogUrl={config.catalogUrl}>
      <div className="pdlc-studio-shell" data-testid="pdlc-opendesign">
        <PlatformHeader currentServiceKey={config.applicationKey}
          leading={<PlatformMark withName size="sm" />}
          actions={<DropdownMenu><DropdownMenuTrigger asChild>
            <Button variant="ghost" aria-label="Аккаунт PDLC">{phase === 'ready' ? name ?? 'Аккаунт' : 'Аккаунт'}</Button>
          </DropdownMenuTrigger><DropdownMenuContent align="end">
            {phase === 'ready' && <><p>{name}</p><p>{email}</p></>}<ThemeMenuItems />
            <DropdownMenuItem disabled={ending || (phase !== 'ready' && phase !== 'error')}
              onSelect={() => void logout()}>Выйти</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>} />
        <div className="pdlc-studio-content">
          {phase === 'ready' && token ? <RequireApplicationAccess application={config.applicationKey}><App /></RequireApplicationAccess>
          : phase === 'login'
            ? <PlatformLogin pending={ending} error={error} onSignIn={login} />
            : phase === 'error' ? <ErrorState message={error ?? 'Не удалось проверить доступ.'}
              onRetry={() => { setPhase('loading'); setNonce((value) => value + 1); }} /> : <LoadingState />}
          {phase === 'ready' && error && <p role="alert">{error}</p>}
        </div>
      </div>
    </PlatformServicesProvider>
    </ApplicationAccessProvider>
  </Router>;
}
