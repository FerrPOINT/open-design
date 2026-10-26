import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolTokenRegistry, PROJECT_EXPORT_TOOL_ENDPOINT } from '../../src/tool-tokens.js';
import { createPdlcToolAuthorization } from '../../src/http/pdlc-tool-authorization.js';

const registry = new ToolTokenRegistry();
const resolve = createPdlcToolAuthorization(registry);
const req = (token: string, path: string) => ({ path,
  get: ((_name: string) => `Bearer ${token}`) as import('express').Request['get'] });
afterEach(() => registry.clear());

describe('initiating authority on run capabilities', () => {
  it('keeps server-only authority out of public grants and rejects a broader endpoint', async () => {
    const authorize = vi.fn(async () => ({ identity: { subject: 'alice', email: 'a@example.test', displayName: 'Alice' },
      sessionId: 'session', expiresAt: Date.now() + 60_000, deadline: performance.now() + 60_000 }));
    const grant = registry.mint({ runId: 'run-1', projectId: 'project-a',
      allowedEndpoints: ['/api/tools/library/search'], authorization: { key: 'binding', authorize } });
    expect(Object.hasOwn(grant, 'authorization')).toBe(false);
    expect(JSON.stringify(grant)).not.toContain('binding');
    expect(resolve(req(grant.token, '/api/projects'))).toBeNull();
    const delegated = resolve(req(grant.token, '/api/tools/library/search'))!;
    expect((await delegated.authorize()).identity.subject).toBe('alice');
    registry.revokeRun('run-1');
    await expect(delegated.authorize()).rejects.toMatchObject({ status: 401 });
    expect(authorize).toHaveBeenCalledTimes(1);
  });
  it('does not turn a project export capability into access to another project', () => {
    const authorize = vi.fn();
    const grant = registry.mint({ runId: 'run-2', projectId: 'project-a',
      allowedEndpoints: [PROJECT_EXPORT_TOOL_ENDPOINT], authorization: { key: 'binding', authorize } });
    expect(resolve(req(grant.token, '/api/projects/project-a/export/pdf-image'))).not.toBeNull();
    expect(resolve(req(grant.token, '/api/projects/project-b/export/pdf-image'))).toBeNull();
    expect(resolve(req(grant.token, '/api/projects/%ZZ/export/pdf-image'))).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
  });
  it('never grants platform authority to a legacy unbound capability', () => {
    const grant = registry.mint({ runId: 'legacy', projectId: 'project-a' });
    expect(registry.validate(grant.token).ok).toBe(true);
    expect(resolve(req(grant.token, '/api/tools/library/search'))).toBeNull();
  });
});
