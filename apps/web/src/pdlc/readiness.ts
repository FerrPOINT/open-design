import { useEffect } from 'react';
import { getPlatformProduct, usePlatformReadiness } from '@pdlc/ui/platform';

/** Product state, rather than DOM timing, determines whether the host can commit. */
export function usePdlcReadiness(pending: boolean, error: string | null = null): void {
  usePlatformReadiness({ pending, error });
  useEffect(() => {
    getPlatformProduct()?.readiness({ ready: !pending, error });
  }, [pending, error]);
}
