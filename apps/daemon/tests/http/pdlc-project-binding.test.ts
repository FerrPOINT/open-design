import { expect, test, vi } from 'vitest';
import type { Response } from 'express';
import { validTrackerFilter, matchesTrackerProject, validateNewTrackerBinding, preserveTrackerBinding } from '../../src/http/pdlc-project-binding.js';
import { TrackerProjectsError } from '../../src/http/pdlc-projects.js';
const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';
function response(catalog = vi.fn().mockResolvedValue({ projects: [{ id: one }] })) {
  const res = { locals: { pdlc: {}, pdlcTrackerProjects: catalog }, status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}
test('classification filter keeps old API behavior and separates two bindings and legacy works', () => {
  expect(validTrackerFilter([one, two])).toBe(false);
  expect(validTrackerFilter('bad')).toBe(false);
  expect(validTrackerFilter(one)).toBe(true);
  expect(matchesTrackerProject({ kind: 'prototype', trackerProjectId: one }, undefined)).toBe(true);
  expect(matchesTrackerProject({ kind: 'prototype', trackerProjectId: one }, one)).toBe(true);
  expect(matchesTrackerProject({ kind: 'prototype', trackerProjectId: two }, one)).toBe(false);
  expect(matchesTrackerProject(undefined, 'none')).toBe(true);
  expect(matchesTrackerProject({ kind: 'prototype', trackerProjectId: one }, 'none')).toBe(false);
});
test('assignment checks the initiating catalog; empty/unavailable Tracker cannot grant a binding', async () => {
  expect(await validateNewTrackerBinding(response(), one)).toBe(true);
  const denied = response(); expect(await validateNewTrackerBinding(denied, two)).toBe(false);
  expect(denied.status).toHaveBeenCalledWith(403);
  const down = response(vi.fn().mockRejectedValue(new TrackerProjectsError(503)));
  expect(await validateNewTrackerBinding(down, one)).toBe(false);
  expect(down.status).toHaveBeenCalledWith(503);
  expect(await validateNewTrackerBinding(down, undefined)).toBe(true);
});
test('ordinary metadata replacements preserve binding but cannot move or clear it', () => {
  const existing = { kind: 'prototype' as const, trackerProjectId: one };
  const patch = { metadata: { kind: 'prototype' as const, fidelity: 'high-fidelity' as const } };
  expect(preserveTrackerBinding(response(), existing, patch)).toBe(true);
  expect(patch.metadata).toMatchObject({ trackerProjectId: one, fidelity: 'high-fidelity' });
  expect(preserveTrackerBinding(response(), existing, { metadata: null })).toBe(false);
  expect(preserveTrackerBinding(response(), existing, { metadata: { ...existing, trackerProjectId: two } })).toBe(false);
  expect(preserveTrackerBinding(response(), undefined, { metadata: existing })).toBe(false);
});
