import express, { type Response } from 'express';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { registerProjectConversationRoutes, type RegisterProjectConversationRoutesDeps } from '../../src/routes/project/conversations.js';
import type { AuthorizeProjectRequest } from '../../src/collab/project-request-authority.js';

vi.mock('../../src/routes/project/comments.js', () => ({ registerProjectCommentRoutes: vi.fn() }));

it('resolves the stored parent, applies its read authority and hides internal conversations', async () => {
  const conversation = { id: 'normal', projectId: 'parent', title: 'Private title' };
  let allowed = true;
  const authorize = vi.fn<AuthorizeProjectRequest>(async (_req, res, projectId, options) => {
    expect(projectId).toBe('parent'); expect(options).toEqual({ mode: 'read' });
    if (!allowed) res.status(403).json({ error: 'denied' });
    return allowed;
  });
  const ctx = {
    db: {}, design: {}, paths: {}, ids: {}, appConfig: {}, agents: {},
    http: { sendApiError: (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } }) },
    projectStore: { getProject: (_db: unknown, id: string) => id === 'parent' ? { id } : null },
    conversations: { getConversation: (_db: unknown, id: string) => id === 'normal' ? conversation
      : id === 'comment-anchor-parent' ? { ...conversation, id }
        : id === 'orphan' ? { ...conversation, id, projectId: 'missing' } : null },
    authorizeProjectRequest: authorize,
  } as unknown as RegisterProjectConversationRoutesDeps;
  const app = express(); registerProjectConversationRoutes(app, ctx);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/conversations/`;
  try {
    expect(await (await fetch(url + 'normal?projectId=forged')).json()).toEqual({ conversation });
    expect(authorize).toHaveBeenCalledTimes(1);
    allowed = false;
    const denied = await fetch(url + 'normal'); expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('Private title');
    for (const id of ['missing', 'orphan', 'comment-anchor-parent']) {
      const response = await fetch(url + id); expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('Private title');
    }
    expect(authorize).toHaveBeenCalledTimes(2);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
