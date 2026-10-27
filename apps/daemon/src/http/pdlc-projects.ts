import { pdlcAuthOrigin } from './pdlc-config.js';

/** Explicit installation transport; no project DB, service credential or browser-selected destination. */
export function trackerProjectsOrigin(value: string | undefined): string | null {
  return value ? pdlcAuthOrigin(value, value) : null;
}

export class TrackerProjectsError extends Error {
  constructor(readonly status: number) { super('Task Tracker projects unavailable'); }
}

export async function trackerProjects(origin: string | null, token: string, requestId: string) {
  if (!origin) throw new TrackerProjectsError(503);
  let response: Response;
  try {
    response = await fetch(new URL('/api/v1/projects', origin), {
      headers: { Authorization: `Bearer ${token}`, 'X-Request-ID': requestId },
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
  } catch { throw new TrackerProjectsError(503); }
  if (!response.ok) throw new TrackerProjectsError([401, 403].includes(response.status) ? 403 : 503);
  try {
    const data = await response.json() as { projects?: unknown };
    if (!Array.isArray(data.projects) || !data.projects.every(project => project &&
      ['id', 'key', 'name'].every(field => typeof project[field] === 'string' && project[field].length > 0))) {
      throw new Error('Invalid Tracker catalog');
    }
    return { projects: data.projects.map(({ id, key, name }: { id: string; key: string; name: string }) => ({ id, key, name })) };
  } catch { throw new TrackerProjectsError(503); }
}
