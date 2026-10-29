import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PdlcInferenceStatus } from '@open-design/contracts';
import { useI18n } from '../i18n';

const Access = createContext<PdlcInferenceStatus | null>(null);
export function usePdlcInference(): PdlcInferenceStatus | null { return useContext(Access); }
export function InferenceAccess({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const ru = locale === 'ru';
  const [status, setStatus] = useState<PdlcInferenceStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setStatus(null); setAttempt(value => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/pdlc/inference/status', { credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) }).then(async response => {
      if (!response.ok) throw new Error('Access check failed');
      const value = await response.json() as PdlcInferenceStatus;
      if (!controller.signal.aborted) setStatus(value);
    }).catch(() => { if (!controller.signal.aborted) setStatus({ state: 'hub_unavailable', model: null }); });
    return () => controller.abort();
  }, [attempt]);
  const reasons: Record<PdlcInferenceStatus['state'], string> = ru ? {
    ready: 'Доступ к модели проверен', not_configured: 'Подключение модели не настроено',
    access_denied: 'Нет доступа к модели', model_unavailable: 'Модель недоступна в каталоге',
    hub_unavailable: 'Не удалось проверить подключение модели',
  } : { ready: 'Model access checked', not_configured: 'Model connection is not configured', access_denied: 'Model access denied',
    model_unavailable: 'Model is unavailable in the catalog', hub_unavailable: 'Model connection check failed' };
  return <Access.Provider value={status}>
    <div className="pdlc-inference-status" role="status" data-state={status?.state ?? 'checking'}>
      <span>{status ? reasons[status.state] : ru ? 'Проверка доступа к модели…' : 'Checking model access…'}{status?.model ? ` · ${status.model}` : ''}</span>
      <button type="button" onClick={retry}>{ru ? 'Проверить' : 'Check'}</button>
    </div>
    {children}
  </Access.Provider>;
}
