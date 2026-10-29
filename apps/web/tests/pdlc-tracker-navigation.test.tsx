// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TrackerProjectPicker } from '../src/pdlc/TrackerProjectPicker';
import { selectedTrackerProject, setTrackerProject } from '../src/pdlc/tracker-context';
import { navigatePath, registerNavigationGuard } from '../src/router';
import { I18nProvider } from '../src/i18n';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const work = '/projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let dispose = () => {};
afterEach(() => { dispose(); cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); setTrackerProject(''); });

async function openPicker(route = work) {
  window.history.replaceState(null, '', route);
  sessionStorage.setItem('open-design:pdlc-tracker-project:navigation', a);
  vi.stubGlobal('fetch', vi.fn(async (url) => new Response(JSON.stringify(String(url) === '/api/pdlc/projects'
    ? { projects: [{ id: a, key: 'A', name: 'Tracker A' }, { id: b, key: 'B', name: 'Tracker B' }] }
    : { project: { metadata: { trackerProjectId: a } } }))));
  render(<I18nProvider initial="en"><TrackerProjectPicker subject="navigation" /></I18nProvider>);
  await waitFor(() => expect(selectedTrackerProject()).toBe(a));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Task Tracker project' }), { key: 'ArrowDown', code: 'ArrowDown' });
  await screen.findByRole('menuitemradio', { name: 'Tracker B' });
}

it.each([true, false])('checks unsaved changes once, accepting=%s', async allowed => {
  await openPicker();
  // A second confirmation may be refused even after the first was accepted.
  const guard = vi.fn().mockReturnValueOnce(allowed).mockReturnValue(false);
  dispose = registerNavigationGuard(guard);
  expect(screen.queryByRole('menuitemradio', { name: 'Project unavailable' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tracker B' }));
  await waitFor(() => expect(guard).toHaveBeenCalledOnce());
  await waitFor(() => expect(selectedTrackerProject()).toBe(allowed ? b : a));
  expect(window.location.pathname).toBe(allowed ? '/projects' : work);
});

it('changes the filter when the project list is already open', async () => {
  await openPicker('/projects');
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tracker B' }));
  await waitFor(() => expect(selectedTrackerProject()).toBe(b));
  expect(window.location.pathname).toBe('/projects');
});

it('does not commit a context belonging to a superseded navigation', async () => {
  await openPicker();
  let allow!: (value: boolean) => void;
  const guard = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { allow = resolve; })).mockReturnValue(true);
  dispose = registerNavigationGuard(guard);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tracker B' }));
  await waitFor(() => expect(guard).toHaveBeenCalledOnce());
  navigatePath('/settings');
  await waitFor(() => expect(window.location.pathname).toBe('/settings'));
  allow(true);
  await new Promise<void>(resolve => queueMicrotask(resolve));
  expect(selectedTrackerProject()).toBe(a);
});
