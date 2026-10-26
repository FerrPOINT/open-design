import type { PdlcConfiguration } from '@open-design/contracts';

declare global {
  interface Window { __OD_PDLC_CONFIG__?: PdlcConfiguration | null; }
}

export function isPdlcMode(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__OD_PDLC_CONFIG__);
}
