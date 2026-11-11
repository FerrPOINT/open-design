import type { Express } from 'express';
import multer from 'multer';
import { getProject } from '../../db.js';
import { importFigmaFromBytes } from '../../figma/figma-import.js';
import { decodeMultipartFilename, resolveProjectDir } from '../../projects.js';
import type { HttpDeps, PathDeps } from '../../server-context.js';
import type { AuthorizeProjectRequest } from '../../collab/project-request-authority.js';

interface FigmaRoutesDeps {
  db: Parameters<typeof getProject>[0];
  paths: Pick<PathDeps, 'PROJECTS_DIR'>;
  http: Pick<HttpDeps, 'sendApiError' | 'sendMulterError'>;
  authorizeProjectRequest: AuthorizeProjectRequest;
}

// The offline decoder consumes bytes directly; large community kits need the
// existing 200 MiB limit, without a temporary upload directory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

export function registerFigmaRoutes(app: Express, ctx: FigmaRoutesDeps) {
  const { db, paths, authorizeProjectRequest } = ctx;
  const { sendApiError, sendMulterError } = ctx.http;

  app.post('/api/projects/:id/figma/import', (req, res) => {
    upload.single('file')(req, res, async (error: unknown) => {
      if (error) return sendMulterError(res, error);
      try {
        const project = getProject(db, req.params.id);
        if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        if (!await authorizeProjectRequest(req, res, project.id, {
          mode: 'write', capability: 'writeFiles',
        })) return;

        const body: { figmaUrl?: unknown; notes?: unknown } = req.body ?? {};
        const figmaUrl = typeof body.figmaUrl === 'string' ? body.figmaUrl.trim() : '';
        if (!req.file) {
          if (figmaUrl) {
            return sendApiError(
              res, 409, 'FIGMA_URL_NEEDS_MIGRATION',
              'Figma URL imports must run through the Figma migration flow.',
              { details: { figmaUrl } },
            );
          }
          return sendApiError(res, 400, 'BAD_REQUEST', 'file is required');
        }

        const result = await importFigmaFromBytes(req.file.buffer, {
          cwd: resolveProjectDir(paths.PROJECTS_DIR, req.params.id, project.metadata),
          label: decodeMultipartFilename(req.file.originalname || 'figma-import.fig'),
          ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
        });
        return res.json(result);
      } catch (caught) {
        return sendApiError(
          res, 400, 'FIGMA_IMPORT_FAILED',
          caught instanceof Error ? caught.message : String(caught),
        );
      }
    });
  });
}
