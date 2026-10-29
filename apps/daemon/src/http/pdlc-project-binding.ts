import type { Response } from 'express';
import type { ProjectMetadata } from '@open-design/contracts';
import { TrackerProjectsError } from './pdlc-projects.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validTrackerFilter(value: unknown): value is string | undefined {
  return value === undefined || value === 'none' || (typeof value === 'string' && uuid.test(value));
}
export function matchesTrackerProject(metadata: ProjectMetadata | null | undefined, filter: string | undefined): boolean {
  return filter === undefined || (metadata?.trackerProjectId ?? 'none') === filter;
}
/** Classification is validated by Tracker; it never grants access to studio files. */
export async function validateNewTrackerBinding(res: Response, id: unknown): Promise<boolean> {
  if (!res.locals.pdlc || id === undefined) return true;
  if (typeof id !== 'string' || !uuid.test(id)) {
    res.status(400).json({ error: { code: 'PDLC_INVALID_TRACKER_PROJECT', message: 'Некорректный проект Tracker.' } });
    return false;
  }
  try {
    const catalog = await res.locals.pdlcTrackerProjects() as { projects: Array<{ id: string }> };
    if (catalog.projects.some(project => project.id === id)) return true;
    res.status(403).json({ error: { code: 'PDLC_TRACKER_PROJECT_DENIED', message: 'Проект недоступен в Tracker.' } });
  } catch (error) {
    res.status(error instanceof TrackerProjectsError ? error.status : 503).json({ error: {
      code: 'PDLC_TRACKER_PROJECTS_UNAVAILABLE', message: 'Не удалось проверить проект Tracker.',
    } });
  }
  return false;
}
/** Generic replacement must neither erase nor move a work's binding. */
export function preserveTrackerBinding(res: Response, existing: ProjectMetadata | null | undefined,
  patch: { metadata?: ProjectMetadata | null }): boolean {
  if (!res.locals.pdlc || patch.metadata === undefined) return true;
  const id = existing?.trackerProjectId;
  if ((patch.metadata === null && id) ||
    (patch.metadata?.trackerProjectId !== undefined && patch.metadata.trackerProjectId !== id)) {
    res.status(400).json({ error: { code: 'PDLC_TRACKER_BINDING_IMMUTABLE', message: 'Изменение проекта Tracker не поддерживается.' } });
    return false;
  }
  if (id && patch.metadata) patch.metadata = { ...patch.metadata, trackerProjectId: id };
  return true;
}
