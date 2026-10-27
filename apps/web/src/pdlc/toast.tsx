import { useEffect, useId, useRef } from 'react';
import { toast } from '@pdlc/ui/ui';
import type { ToastProps } from '../components/Toast';

/** Adapt product messages/actions; Base owns rendering, queue, dismissal and timing. */
export function PlatformToast(props: ToastProps) {
  const id = useId();
  const callbacks = useRef(props);
  callbacks.current = props;
  const { message, details, code, ttlMs = 4000, tone = 'default', role, actionLabel, placement } = props;
  const hasAction = Boolean(props.onAction);
  const actionAriaLabel = props.actionAriaLabel;
  useEffect(() => {
    let active = true;
    const notify = tone === 'success' ? toast.success : tone === 'loading' ? toast.loading
      : tone === 'error' || role === 'alert' ? toast.error : toast;
    const dismissed = () => { if (active) callbacks.current.onDismiss?.(); };
    notify(message, { id, description: code ? <>{details && <p>{details}</p>}<pre>{code}</pre></> : details,
      duration: code ? Infinity : ttlMs, position: placement === 'top' ? 'top-right' : 'bottom-right',
      action: actionLabel && hasAction ? { label: <span aria-label={actionAriaLabel}>{actionLabel}</span>, onClick: () => callbacks.current.onAction?.() } : undefined,
      onDismiss: dismissed, onAutoClose: dismissed,
    });
    return () => { active = false; toast.dismiss(id); };
  }, [id, message, details, code, ttlMs, tone, role, actionLabel, actionAriaLabel, placement, hasAction]);
  return null;
}
