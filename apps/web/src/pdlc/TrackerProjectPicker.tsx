import { useEffect, useState } from 'react';
import { Button, ProjectPicker } from '@pdlc/ui/ui';
import { useI18n } from '../i18n';
import { useRoute, navigatePath } from '../router';
import { useTrackerProject, setTrackerProject, selectedTrackerProject } from './tracker-context';

interface TrackerProject { id: string; key: string; name: string; }

/** Tracker owns the catalog and access; this tab stores only its selected working context. */
export function TrackerProjectPicker({ subject }: { subject: string }) {
  const { locale } = useI18n();
  const ru = locale === 'ru';
  const storageKey = `open-design:pdlc-tracker-project:${subject}`;
  const selected = useTrackerProject();
  const route = useRoute();
  useEffect(() => {
    try { setTrackerProject(sessionStorage.getItem(storageKey) ?? ''); } catch { setTrackerProject(''); }
  }, [storageKey]);
  useEffect(() => {
    if (route.kind !== 'project') return;
    const controller = new AbortController();
    void fetch(`/api/projects/${encodeURIComponent(route.projectId)}`, { signal: controller.signal, redirect: 'error' })
      .then(async response => {
        if (!response.ok) return;
        const value = await response.json();
        if (!controller.signal.aborted) setTrackerProject(value.project?.metadata?.trackerProjectId ?? '');
      }).catch(() => {});
    return () => controller.abort();
  }, [route.kind, route.kind === 'project' ? route.projectId : null]);
  const [projects, setProjects] = useState<TrackerProject[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false); setProjects(null);
    void fetch('/api/pdlc/projects', { credentials: 'same-origin', redirect: 'error',
      cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Tracker projects unavailable');
      const value = await response.json() as { projects: TrackerProject[] };
      if (controller.signal.aborted) return;
      setProjects(value.projects);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [subject, attempt]);
  useEffect(() => {
    // The mount effect restores this account before persistence runs. Read the
    // current store rather than an old subject's render snapshot.
    const current = selectedTrackerProject();
    try {
      if (current) sessionStorage.setItem(storageKey, current);
      else sessionStorage.removeItem(storageKey);
    } catch { /* Working context is optional tab state, never access authority. */ }
  }, [selected, storageKey]);
  return <div className="pdlc-tracker-picker"><ProjectPicker value={selected || 'none'} allowEmpty={false} onChange={id => {
    const commit = () => setTrackerProject(id === 'none' ? '' : id);
    navigatePath('/projects', { onCommit: commit, onCancel: reason => {
      if (reason === 'same_route') commit();
    } });
  }} style={{ maxWidth: 240 }}
    aria-label={ru ? 'Проект Task Tracker' : 'Task Tracker project'}
    placeholder={ru ? 'Проект недоступен' : 'Project unavailable'}
    options={[{ value: 'none', label: ru ? 'Без проекта' : 'Unassigned' },
      ...(projects ?? []).map(project => ({ value: project.id, label: project.name, projectKey: project.key })),
      ...(selected && projects && !projects.some(project => project.id === selected)
        ? [{ value: selected, label: ru ? 'Проект недоступен' : 'Project unavailable' }] : [])]} />
    {failed && <Button variant="ghost" onClick={() => setAttempt(value => value + 1)}>
      {ru ? 'Каталог недоступен · Повторить' : 'Catalog unavailable · Retry'}</Button>}</div>;
}
