// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudSignInTip } from '../src/components/CloudSignInTip';
import { AmrLoginPill } from '../src/components/AmrLoginPill';
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
  const { container } = render(<><CloudSignInTip /><AmrLoginPill /></>);
  expect(container).toBeEmptyDOMElement();
  expect(fetcher).not.toHaveBeenCalled();
});

it('retains the native Cloud sign-in card outside PDLC', () => {
  render(<I18nProvider initial="en"><CloudSignInTip /></I18nProvider>);
  expect(screen.getByTestId('entry-cloud-signin-tip')).toBeVisible();
});

it('excludes only the Cloud agent in PDLC while keeping local CLI choices', () => {
  expect(isVisibleLocalCliAgent({ id: 'amr' })).toBe(true);
  enablePdlc();
  expect(isVisibleLocalCliAgent({ id: 'amr' })).toBe(false);
  expect(isVisibleLocalCliAgent({ id: 'codex' })).toBe(true);
  expect(isVisibleLocalCliAgent({ id: 'opencode' })).toBe(true);
  expect(isVisibleLocalCliAgent({ id: 'byok-opencode' })).toBe(false);
});
