import { useEffect, useState } from 'react';
import { Button, ProjectPicker } from '@pdlc/ui/ui';
import { useI18n } from '../i18n';

interface TrackerProject { id: string; key: string; name: string; }

/** Tracker owns the catalog and access; this tab stores only its selected working context. */
export function TrackerProjectPicker({ subject }: { subject: string }) {
  const { locale } = useI18n();
  const ru = locale === 'ru';
  const storageKey = `open-design:pdlc-tracker-project:${subject}`;
  const [selected, setSelected] = useState(() => {
    try { return sessionStorage.getItem(storageKey) ?? ''; } catch { return ''; }
  });
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
      setSelected(previous => value.projects.some(project => project.id === previous) ? previous : '');
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [subject, attempt]);
  useEffect(() => {
    if (!projects) return;
    try {
      if (selected) sessionStorage.setItem(storageKey, selected);
      else sessionStorage.removeItem(storageKey);
    } catch { /* Working context is optional tab state, never access authority. */ }
  }, [selected, projects, storageKey]);
  if (failed) return <Button variant="ghost" onClick={() => setAttempt(value => value + 1)}>
    {ru ? 'Проекты недоступны · Повторить' : 'Projects unavailable · Retry'}</Button>;
  return <ProjectPicker value={selected} onChange={setSelected}
    aria-label={ru ? 'Проект Task Tracker' : 'Task Tracker project'}
    disabled={!projects?.length} placeholder={!projects ? (ru ? 'Загрузка проектов…' : 'Loading projects…')
      : !projects.length ? (ru ? 'Нет доступных проектов' : 'No accessible projects') : (ru ? 'Все проекты' : 'All projects')}
    options={(projects ?? []).map(project => ({ value: project.id, label: project.name, projectKey: project.key }))} />;
}
