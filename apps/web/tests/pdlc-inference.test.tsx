// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { InferenceAccess } from '../src/pdlc/InferenceAccess';
import { ChatComposer } from '../src/components/ChatComposer';
import { HomeHero } from '../src/components/HomeHero';
import { AssistantFooter } from '../src/components/AssistantMessage';
import { I18nProvider } from '../src/i18n';
import { flushMounts, pressEnter, typeAndSettle } from './helpers/lexical-composer';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.__OD_PDLC_CONFIG__; });
const homeProps = { prompt: 'Create a small page', onPromptChange: () => {}, onSubmit: vi.fn(),
  activePluginTitle: null, activeChipId: null, onClearActivePlugin: () => {}, pluginOptions: [],
  pluginsLoading: false, pendingPluginId: null, pendingChipId: null, onPickPlugin: () => {},
  onPickChip: () => {}, contextItemCount: 0, error: null };
test('home generation uses the same access gate and unlocks only after an explicit successful check', async () => {
  window.__OD_PDLC_CONFIG__ = { issuer: 'https://auth.example', clientId: 'open-design',
    publicOrigin: 'https://design.example', hostOrigin: null, catalogUrl: null, applicationKey: 'open-design' };
  let allowed = false;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ state: allowed ? 'ready' : 'access_denied', model: 'main-dev' }))));
  const onSubmit = vi.fn();
  render(<I18nProvider initial="en"><InferenceAccess><HomeHero {...homeProps} onSubmit={onSubmit} /></InferenceAccess></I18nProvider>);
  await screen.findByText('Model access denied · main-dev');
  expect(screen.getByTestId('home-hero-submit')).toBeDisabled();
  fireEvent.click(screen.getByTestId('home-hero-submit')); expect(onSubmit).not.toHaveBeenCalled();
  allowed = true; fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByText('Model access checked · main-dev');
  await waitFor(() => expect(screen.getByTestId('home-hero-submit')).not.toBeDisabled());
  fireEvent.click(screen.getByTestId('home-hero-submit')); expect(onSubmit).toHaveBeenCalledTimes(1);
});
test('standalone home generation does not require a PDLC model check', () => {
  render(<I18nProvider initial="en"><HomeHero {...homeProps} /></I18nProvider>);
  expect(screen.getByTestId('home-hero-submit')).not.toBeDisabled();
});
test('a typed prompt stays unsent until a user-initiated non-inference access check succeeds', async () => {
  window.__OD_PDLC_CONFIG__ = { issuer: 'https://auth.example', clientId: 'open-design',
    publicOrigin: 'https://design.example', hostOrigin: null, catalogUrl: null, applicationKey: 'open-design' };
  let allowed = false;
  const request = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input) === '/api/pdlc/inference/status' ? { state: allowed ? 'ready' : 'access_denied', model: 'studio-main' } : {})));
  vi.stubGlobal('fetch', request);
  const onSend = vi.fn();
  render(<I18nProvider initial="en"><InferenceAccess><ChatComposer projectId="studio" projectFiles={[]}
    streaming={false} onEnsureProject={async () => 'studio'} onSend={onSend} onStop={vi.fn()} /></InferenceAccess></I18nProvider>);
  await screen.findByText('Model access denied · studio-main');
  await flushMounts();
  await typeAndSettle('Create a small page');
  expect(screen.getByTestId('chat-send')).toBeDisabled();
  pressEnter(); expect(onSend).not.toHaveBeenCalled();
  allowed = true; fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByText('Model access checked · studio-main');
  await waitFor(() => expect(screen.getByTestId('chat-send')).not.toBeDisabled());
  expect(request.mock.calls.filter(([url]) => String(url).includes('/inference/status'))).toHaveLength(2);
  expect(request.mock.calls.some(([url]) => /chat\/completions|\/api\/runs/.test(String(url)))).toBe(false);
});

test('only an explicit user stop is attributed to the user', () => {
  const footer = (cancelOrigin: 'unknown' | 'user_stop') => <I18nProvider initial="en"><AssistantFooter
    streaming={false} hasUnfinishedTodos={false} hasEmptyResponse={false} canceled cancelOrigin={cancelOrigin} forceVisible /></I18nProvider>;
  const view = render(footer('unknown'));
  expect(screen.queryByText('This run was stopped at your request.')).toBeNull();
  view.rerender(footer('user_stop'));
  expect(screen.getByText('This run was stopped at your request.')).toBeVisible();
});
