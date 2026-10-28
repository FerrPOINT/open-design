// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudSignInTip } from '../src/components/CloudSignInTip';
import { AmrLoginPill } from '../src/components/AmrLoginPill';
import { ShareSignInButton } from '../src/components/share/ShareSignInButton';
import { EntryNavRail } from '../src/components/EntryNavRail';
import { I18nProvider } from '../src/i18n';
import { isVisibleLocalCliAgent } from '../src/utils/visibleAgents';

afterEach(() => {
  cleanup();
  delete window.__OD_PDLC_CONFIG__;
  vi.unstubAllGlobals();
});

function enablePdlc() {
  window.__OD_PDLC_CONFIG__ = {
    issuer: 'https://auth.example', clientId: 'open-design', publicOrigin: 'https://design.example',
    applicationKey: 'open-design', hostOrigin: null, catalogUrl: null,
  };
}

it('does not mount Cloud login controls or start their effects in PDLC', () => {
  enablePdlc();
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(<><CloudSignInTip sharePrompt /><AmrLoginPill />
    <ShareSignInButton variant="primary" actionLabel="Sign in" /></>);
  expect(container).toBeEmptyDOMElement();
  expect(fetcher).not.toHaveBeenCalled();
});

it('retains the native Cloud sign-in card outside PDLC', () => {
  render(<I18nProvider initial="en"><CloudSignInTip /></I18nProvider>);
  expect(screen.getByTestId('entry-cloud-signin-tip')).toBeVisible();
});

it('retains the native share sign-in button outside PDLC', () => {
  render(<I18nProvider initial="en"><ShareSignInButton variant="primary" actionLabel="Sign in to share" /></I18nProvider>);
  expect(screen.getByRole('button', { name: 'Sign in to share' })).toBeVisible();
});

it('excludes only the Cloud agent in PDLC while keeping local CLI choices', () => {
  expect(isVisibleLocalCliAgent({ id: 'amr' })).toBe(true);
  enablePdlc();
  expect(isVisibleLocalCliAgent({ id: 'amr' })).toBe(false);
  expect(isVisibleLocalCliAgent({ id: 'codex' })).toBe(true);
  expect(isVisibleLocalCliAgent({ id: 'opencode' })).toBe(true);
  expect(isVisibleLocalCliAgent({ id: 'byok-opencode' })).toBe(false);
});

it.each([false, true])('retains native navigation with PDLC=%s and removes only upstream outreach', (pdlc) => {
  if (pdlc) enablePdlc();
  const fetcher = vi.fn().mockResolvedValue(new Response('{"messages":[]}'));
  vi.stubGlobal('fetch', fetcher);
  render(<I18nProvider initial="en"><EntryNavRail view="home" context={null} open
    onViewChange={vi.fn()} onNewProject={vi.fn()} onOpenSettings={vi.fn()} /></I18nProvider>);
  expect(screen.getByTestId('entry-settings-button')).toBeVisible();
  if (pdlc) {
    expect(screen.queryByTestId('entry-nav-rail-social')).not.toBeInTheDocument();
    expect(screen.queryByTestId('entry-nav-message-center')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/messages'))).toBe(false);
  } else {
    expect(screen.getByTestId('entry-nav-rail-social')).toBeVisible();
    expect(screen.getByTestId('entry-nav-message-center')).toBeVisible();
  }
});
