import { afterEach, expect, it, vi } from 'vitest';
import { handleMcpToolCall } from '../src/mcp.js';
import { _resetMcpWorkspaceContextCacheForTests } from '../src/mcp-workspace-context.js';

const tracker = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
afterEach(() => { _resetMcpWorkspaceContextCacheForTests(); vi.unstubAllGlobals(); });

it.each([undefined, tracker, 'none'])('passes list_projects Tracker filter %s in either catalog', async filter => {
  for (const scoped of [false, true]) {
    _resetMcpWorkspaceContextCacheForTests();
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(url.endsWith('/api/workspace/directory') ? { items: scoped ? [{
        workspaceId: 'ws', workspaceName: 'Personal', workspaceType: 'personal', workspaceMemberId: 'member',
        role: 'owner', memberStatus: 'active', lifecycleState: 'active',
      }] : [] } : { projects: [] }));
    }));
    const result = await handleMcpToolCall('http://127.0.0.1:19501', 'list_projects', filter ? { trackerProjectId: filter } : {});
    expect(result.isError).not.toBe(true);
    expect(urls.at(-1)).toBe(`http://127.0.0.1:19501/api/${scoped ? 'workspaces/ws/' : ''}projects${filter ? `?trackerProjectId=${filter}` : ''}`);
  }
});

it.each([undefined, tracker])('creates a work with optional Tracker binding %s', async id => {
  let body: unknown;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/workspace/directory')) return new Response('{"items":[]}');
    body = JSON.parse(init!.body as string); return new Response(JSON.stringify({ project: body }));
  }));
  const result = await handleMcpToolCall('http://127.0.0.1:19502', 'create_project', { name: 'Work', ...(id ? { trackerProjectId: id } : {}) });
  expect(result.isError).not.toBe(true);
  expect((body as { metadata?: unknown }).metadata).toEqual(id ? { trackerProjectId: id } : undefined);
});

it.each(['none', 'invalid'])('refuses invalid create binding %s without POST', async id => {
  const fetcher = vi.fn(async () => new Response('{"items":[]}')); vi.stubGlobal('fetch', fetcher);
  const result = await handleMcpToolCall('http://127.0.0.1:19503', 'create_project', { name: 'Invalid', trackerProjectId: id });
  expect(result.isError).toBe(true);
  expect(fetcher.mock.calls).toHaveLength(1); // directory discovery only
});
