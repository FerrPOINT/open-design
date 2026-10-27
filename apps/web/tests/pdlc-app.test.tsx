// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginSso, completeSso, endSso, restoreSso, SsoLoginRequiredError, type SsoSession } from '@pdlc/ui/sso';
import { PdlcApp } from '../src/pdlc/PdlcApp';
import { I18nProvider } from '../src/i18n';
import type { ReactNode } from 'react';
const render = (view: ReactNode) => renderView(<I18nProvider initial="ru">{view}</I18nProvider>);

vi.mock('../src/App', () => ({ App: () => <div data-testid="studio-editor">Editor</div> }));
vi.mock('@pdlc/ui/sso', async (original) => ({
  ...await original<typeof import('@pdlc/ui/sso')>(),
  restoreSso: vi.fn(), completeSso: vi.fn(), beginSso: vi.fn(), endSso: vi.fn(),
}));

const issuer = 'https://auth.example';
function session(): SsoSession {
  const expiresAt = Date.now() + 120_000;
  return { accessToken: 'header.' + btoa(JSON.stringify({ sub: 'alice', exp: expiresAt / 1000 })) + '.signature',
    expiresAt, subject: 'alice', email: 'alice@example.test', name: 'Алиса', returnTo: '/' };
}

describe('PDLC studio entry', () => {
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let profileSubject: string;
  let sessionStatus: number;
  let admissionStatus: number;
  let logoutFailure: boolean;

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    window.__OD_PDLC_CONFIG__ = { issuer, clientId: 'open-design', publicOrigin: window.location.origin,
      hostOrigin: null, catalogUrl: null, applicationKey: 'open-design' };
    document.documentElement.setAttribute('data-pdlc', '');
    window.PdlcThemePreference.set('dark');
    profileSubject = 'alice'; sessionStatus = 200; admissionStatus = 200; logoutFailure = false;
    vi.mocked(restoreSso).mockReset().mockResolvedValue(session());
    vi.mocked(completeSso).mockReset().mockResolvedValue(session());
    vi.mocked(beginSso).mockReset().mockResolvedValue();
    vi.mocked(endSso).mockReset();
    fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === '/api/pdlc/session') return new Response(JSON.stringify({
        identity: { subject: profileSubject, email: 'alice@example.test', displayName: 'Алиса' },
        expiresAt: Date.now() + 120_000,
      }), { status: sessionStatus });
      if (url === '/api/pdlc/logout') {
        if (logoutFailure) throw new TypeError('Product transport unavailable');
        return new Response(null, { status: 204 });
      }
      if (url === issuer + '/auth/access') {
        const now = Date.now();
        return new Response(JSON.stringify({
        schema_version: 1, issuer, subject: 'alice', role: 'user', applications: ['open-design'],
        revision: 1, enforced: true, observed_at: new Date(now).toISOString(),
        expires_at: new Date(now + 60_000).toISOString(),
      }), { status: admissionStatus });
      }
      throw new Error('Unexpected fixture request: ' + url);
    });
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => {
    cleanup(); vi.unstubAllGlobals();
    delete window.__OD_PDLC_CONFIG__;
    document.documentElement.removeAttribute('data-pdlc');
  });

  it('uses the product language for the shared account menu', async () => {
    renderView(<I18nProvider initial="en"><PdlcApp /></I18nProvider>);
    await screen.findByTestId('studio-editor');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'PDLC account' }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeTruthy();
  });

  it('restores the shared session and shows the server-confirmed account', async () => {
    render(<PdlcApp />);
    await screen.findByTestId('studio-editor');
    expect(screen.getByRole('button', { name: 'Аккаунт PDLC' }).textContent).toBe('Алиса');
    expect(beginSso).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith('/api/pdlc/session', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
    }));
  });
  it('does not mount private studio content or show a stored profile during restoration', async () => {
    let finish!: (value: SsoSession) => void;
    vi.mocked(restoreSso).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<PdlcApp />);
    expect(screen.queryByTestId('studio-editor')).toBeNull();
    expect(screen.getByRole('button', { name: 'Аккаунт PDLC' }).textContent).toBe('Аккаунт');
    await act(async () => { finish(session()); });
    await screen.findByTestId('studio-editor');
  });
  it('offers explicit login without a hidden form or an automatic redirect loop', async () => {
    vi.mocked(restoreSso).mockRejectedValue(new SsoLoginRequiredError());
    render(<PdlcApp />);
    const button = await screen.findByRole('button', { name: 'Войти через SSO' });
    expect(screen.queryByTestId('studio-editor')).toBeNull();
    expect(beginSso).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(beginSso).toHaveBeenCalledWith(expect.objectContaining({ issuer }), '/', { interactive: true });
  });
  it('completes the callback and restores the exact deep link', async () => {
    window.history.replaceState(null, '', '/sso/callback?code=fixture&state=fixture');
    vi.mocked(completeSso).mockResolvedValue({ ...session(), returnTo: '/projects/demo?view=files#preview' });
    render(<PdlcApp />);
    await screen.findByTestId('studio-editor');
    expect(completeSso).toHaveBeenCalledTimes(1);
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe('/projects/demo?view=files#preview');
  });
  it('does not mount the studio when the server returns another subject', async () => {
    profileSubject = 'bob';
    render(<PdlcApp />);
    await screen.findByText('Не удалось проверить доступ. Повторите попытку.');
    expect(screen.queryByTestId('studio-editor')).toBeNull();
  });
  it('shows admission denial separately from missing login', async () => {
    sessionStatus = 403;
    render(<PdlcApp />);
    await screen.findByText('Нет доступа к OpenDesign.');
    expect(screen.queryByTestId('studio-editor')).toBeNull();
    expect(beginSso).not.toHaveBeenCalled();
  });
  it('allows a denied account to end SSO without granting studio access', async () => {
    sessionStatus = 403;
    render(<PdlcApp />);
    await screen.findByText('Нет доступа к OpenDesign.');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Аккаунт PDLC' }), { button: 0, ctrlKey: false });
    const logout = await screen.findByRole('menuitem', { name: 'Выйти' });
    expect(logout.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(logout);
    await waitFor(() => expect(endSso).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('studio-editor')).toBeNull();
  });
  it('keeps an Auth outage retryable and does not claim a logout', async () => {
    sessionStatus = 503;
    render(<PdlcApp />);
    await screen.findByText('Не удалось проверить доступ. Повторите попытку.');
    expect(endSso).not.toHaveBeenCalled();
    sessionStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByTestId('studio-editor');
  });
  it('removes private content when the central access provider observes session revocation', async () => {
    admissionStatus = 401;
    render(<PdlcApp />);
    await screen.findByRole('button', { name: 'Войти через SSO' });
    expect(screen.queryByTestId('studio-editor')).toBeNull();
  });
  it('does not bind a late restoration after its document root has unmounted', async () => {
    let finish!: (value: SsoSession) => void;
    vi.mocked(restoreSso).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(<PdlcApp />);
    view.unmount();
    await act(async () => { finish(session()); });
    expect(fetcher).not.toHaveBeenCalledWith('/api/pdlc/session', expect.anything());
  });
  it('uses the shared account menu to select a theme and finish both logout boundaries', async () => {
    render(<PdlcApp />);
    await screen.findByTestId('studio-editor');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Аккаунт PDLC' }), { button: 0, ctrlKey: false });
    const gray = await screen.findByRole('menuitemradio', { name: 'Серая' });
    fireEvent.click(gray);
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('gray'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Аккаунт PDLC' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Выйти' }));
    await waitFor(() => expect(endSso).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('studio-editor')).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('/api/pdlc/logout', expect.objectContaining({ method: 'POST' }));
  });
  it('still ends the central session when the product logout transport is unavailable', async () => {
    logoutFailure = true;
    render(<PdlcApp />);
    await screen.findByTestId('studio-editor');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Аккаунт PDLC' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Выйти' }));
    await waitFor(() => expect(endSso).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('studio-editor')).toBeNull();
    expect(screen.getByRole('button', { name: 'Аккаунт PDLC' }).textContent).toBe('Аккаунт');
    expect(beginSso).not.toHaveBeenCalled();
  });
  it('consumes cross-document invalidation without publishing an echo or exposing a profile', async () => {
    render(<PdlcApp />);
    await screen.findByTestId('studio-editor');
    const writer = vi.spyOn(Storage.prototype, 'setItem');
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'open-design:pdlc-session-boundary', newValue: JSON.stringify({ kind: 'logout', nonce: 'other-tab' }),
    })));
    await screen.findByRole('button', { name: 'Войти через SSO' });
    expect(screen.queryByTestId('studio-editor')).toBeNull();
    expect(writer).not.toHaveBeenCalledWith('open-design:pdlc-session-boundary', expect.anything());
    expect(endSso).not.toHaveBeenCalled();
    writer.mockRestore();
  });
});
