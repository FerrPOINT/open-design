// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createProject } from '../src/state/projects';
import { setTrackerProject } from '../src/pdlc/tracker-context';
afterEach(() => { setTrackerProject(''); vi.unstubAllGlobals(); delete window.__OD_PDLC_CONFIG__; });

test('Tracker classification preserves both native inferred kind and an explicit non-prototype kind', async () => {
  window.__OD_PDLC_CONFIG__ = { issuer: 'https://auth.example', clientId: 'open-design', publicOrigin: 'https://design.example',
    hostOrigin: null, catalogUrl: null, applicationKey: 'open-design' };
  const trackerProjectId = '11111111-1111-4111-8111-111111111111';
  setTrackerProject(trackerProjectId);
  const request = vi.fn<typeof fetch>(async () => Response.json({ project: { id: 'work', name: 'Work', skillId: null, designSystemId: null,
    createdAt: 1, updatedAt: 1 }, conversationId: 'conversation' }));
  vi.stubGlobal('fetch', request);
  await createProject({ name: 'Native inferred kind', skillId: null, designSystemId: null });
  const first = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
  expect(first.metadata).toEqual({ trackerProjectId });
  await createProject({ name: 'Document', skillId: null, designSystemId: null, metadata: { kind: 'other', nameSource: 'user' } });
  const second = JSON.parse(String(request.mock.calls[1]?.[1]?.body));
  expect(second.metadata).toEqual({ kind: 'other', nameSource: 'user', trackerProjectId });
});
