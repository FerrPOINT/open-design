import { afterEach, expect, it, vi } from 'vitest';
import { trackerProjects, trackerProjectsOrigin } from '../../src/http/pdlc-projects.js';
import express from 'express';
import { once } from 'node:events';
import { installPdlcAuth } from '../../src/http/pdlc-auth.js';

afterEach(() => vi.unstubAllGlobals());

it('uses only explicit installation origins with the established private transport validation', () => {
  expect(trackerProjectsOrigin(undefined)).toBeNull();
  expect(trackerProjectsOrigin('http://task-backend:3456')).toBe('http://task-backend:3456');
  for (const invalid of ['http://public.example.org', 'https://user:secret@tracker.example', 'https://tracker.example/redirect']) {
    expect(() => trackerProjectsOrigin(invalid)).toThrow();
  }
});
it('forwards the initiating credential without redirects and exposes only Tracker project fields', async () => {
  const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({projects:[{id:'id-1',key:'BASE',name:'Platform',owner_id:'private'}]})));
  vi.stubGlobal('fetch',transport);
  expect(await trackerProjects('https://tracker.example','browser-token','request-one')).toEqual({projects:[{id:'id-1',key:'BASE',name:'Platform'}]});
  expect(transport).toHaveBeenCalledWith(new URL('https://tracker.example/api/v1/projects'), expect.objectContaining({
    redirect:'error', headers:{Authorization:'Bearer browser-token','X-Request-ID':'request-one'},
  }));
});
it('preserves empty catalogs and rejects owner denial, malformed replies and outages', async () => {
  const transport = vi.fn().mockResolvedValueOnce(new Response('{"projects":[]}'))
    .mockResolvedValueOnce(new Response('',{status:403})).mockResolvedValueOnce(new Response('{"projects":[{"id":"bad"}]}'))
    .mockRejectedValueOnce(new Error('private transport detail'));
  vi.stubGlobal('fetch',transport);
  expect(await trackerProjects('https://tracker.example','token','r')).toEqual({projects:[]});
  await expect(trackerProjects('https://tracker.example','token','r')).rejects.toMatchObject({status:403});
  await expect(trackerProjects('https://tracker.example','token','r')).rejects.toMatchObject({status:503});
  await expect(trackerProjects('https://tracker.example','token','r')).rejects.toMatchObject({status:503,message:'Task Tracker projects unavailable'});
});

it('keeps the project proxy behind the real studio gate and forwards a browser binding to Tracker', async () => {
  const tracker = express(); const received: string[] = [];
  tracker.get('/api/v1/projects', (req,res) => {
    received.push(req.get('authorization') ?? '');
    return res.json({projects:[{id:'tracker-project',key:'BASE',name:'Platform'}]});
  });
  const peer = tracker.listen(0,'127.0.0.1'); await once(peer,'listening');
  const peerOrigin = `http://127.0.0.1:${(peer.address() as {port:number}).port}`;
  const old = process.env.OD_PDLC_TRACKER_URL; process.env.OD_PDLC_TRACKER_URL = peerOrigin;
  const app = express(); app.use(express.json());
  const boundary = installPdlcAuth(app,{issuer:'https://auth.example',clientId:'open-design',publicOrigin:'https://design.example',
    hostOrigin:null,catalogUrl:null,applicationKey:'open-design'},async token => {
    if (token !== 'browser') throw new Error('Denied');
    return {identity:{subject:'alice',email:'alice@example.test',displayName:'Alice'},credential:{kind:'browser',sessionId:'session'},
      expiresAt:Date.now()+60000,deadline:performance.now()+60000};
  });
  if (old === undefined) delete process.env.OD_PDLC_TRACKER_URL; else process.env.OD_PDLC_TRACKER_URL=old;
  const studio = app.listen(0,'127.0.0.1'); await once(studio,'listening');
  const origin = `http://127.0.0.1:${(studio.address() as {port:number}).port}`;
  try {
    expect((await fetch(origin+'/api/pdlc/projects')).status).toBe(401); expect(received).toEqual([]);
    const session = await fetch(origin+'/api/pdlc/session',{method:'POST',headers:{Origin:'https://design.example',Authorization:'Bearer browser'}});
    const result = await fetch(origin+'/api/pdlc/projects',{headers:{Cookie:session.headers.get('set-cookie')!.split(';')[0]!}});
    expect(result.status).toBe(200); expect((await result.json()).projects[0].key).toBe('BASE');
    expect(received).toEqual(['Bearer browser']);
  } finally {
    boundary.dispose(); studio.closeAllConnections(); peer.closeAllConnections();
    await Promise.all([new Promise<void>(resolve=>studio.close(()=>resolve())),new Promise<void>(resolve=>peer.close(()=>resolve()))]);
  }
});
