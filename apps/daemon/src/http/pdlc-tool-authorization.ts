import type { Request } from 'express';
import { MEDIA_TASK_WAIT_TOOL_ENDPOINT, PROJECT_EXPORT_TOOL_ENDPOINT, type ToolTokenRegistry } from '../tool-tokens.js';
import { PdlcAuthError, type PdlcPreviewAuthorization } from './pdlc-auth.js';

/** Existing run capabilities remain narrow; they inherit live initiating admission. */
export function createPdlcToolAuthorization(registry: ToolTokenRegistry) {
  return (req: Pick<Request, 'path' | 'get'>): PdlcPreviewAuthorization | null => {
    const token = /^Bearer (odtt_[A-Za-z0-9_-]+)$/i.exec(req.get('authorization') ?? '')?.[1];
    if (!token) return null;
    const exportPath = /^\/api\/projects\/([^/]+)\/export(?:\/(?:pptx|pdf-image|image))?$/.exec(req.path);
    const endpoint = exportPath ? PROJECT_EXPORT_TOOL_ENDPOINT
      : /^\/api\/media\/tasks\/[^/]+\/wait$/.test(req.path) ? MEDIA_TASK_WAIT_TOOL_ENDPOINT : req.path;
    const checked = registry.validate(token, { endpoint });
    if (!checked.ok) return null;
    if (exportPath) {
      try { if (checked.grant.projectId !== decodeURIComponent(exportPath[1]!)) return null; }
      catch { return null; }
    }
    const authority = registry.authorization(token, { endpoint });
    if (!authority) return null;
    return { key: authority.key, authorize: async () => {
      const fresh = registry.authorization(token, { endpoint });
      if (!fresh) throw new PdlcAuthError(401, 'Run capability expired or revoked');
      return fresh.authorize();
    } };
  };
}
