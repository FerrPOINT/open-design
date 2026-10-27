// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../../src/components/SettingsDialog';
import { I18nProvider } from '../../src/i18n';
import { DEFAULT_CONFIG } from '../../src/state/config';

afterEach(() => { cleanup(); delete window.__OD_PDLC_CONFIG__; });

it('dismisses the active Base select before leaving Settings', async () => {
  window.__OD_PDLC_CONFIG__ = { issuer: 'https://auth.example', clientId: 'open-design',
    publicOrigin: 'https://design.example', hostOrigin: null, catalogUrl: null, applicationKey: 'open-design' };
  const close = vi.fn();
  render(<I18nProvider initial="en"><SettingsDialog presentation="page"
    initial={{ ...DEFAULT_CONFIG }} agents={[]} daemonLive appVersionInfo={null}
    initialSection="general" onPersist={vi.fn()} onPersistComposioKey={vi.fn()}
    onClose={close} onRefreshAgents={vi.fn()} /></I18nProvider>);
  const language = screen.getByRole('combobox', { name: 'Language' });
  fireEvent.keyDown(language, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: 'English · en' });
  fireEvent.keyDown(option, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(language, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});
