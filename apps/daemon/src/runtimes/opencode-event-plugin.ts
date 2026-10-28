import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Generated runtime module, carried in the daemon bundle so packaged users do
// not need an npm plugin install. The provider hook is active only for managed inference runs.
export const OPEN_CODE_EVENT_PLUGIN_SOURCE = String.raw`export default async function () {
  const seen = new Map();
  return {
    config: async (config) => {
      const id = process.env?.OD_PDLC_INFERENCE_PROVIDER || process.env?.OD_PDLC_AI_HUB_PROVIDER;
      if (!id) return;
      const options = config.provider?.[id]?.options;
      if (!options?.baseURL) throw new Error('Inference provider configuration is missing');
      const endpoint = new URL(options.baseURL.replace(/\/$/, '') + '/chat/completions').href;
      const pending = new Map();
      // OpenCode can retry both in the SDK and around a failed stream. Keep the
      // UUID for the exact wire request until a complete response is consumed.
      // A tool step changes the body; a new CLI invocation has its own map.
      options.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (request.url !== endpoint || request.method !== 'POST') throw new Error('Inference destination refused');
        const body = await request.clone().text();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))), b => b.toString(16).padStart(2, '0')).join('');
        let key = pending.get(digest);
        if (!key) {
          if (pending.size >= 256) throw new Error('Inference unresolved request limit reached');
          key = crypto.randomUUID();
          pending.set(digest, key);
        }
        const headers = new Headers(request.headers);
        headers.set('Idempotency-Key', key);
        const response = await fetch(new Request(request, { headers, redirect: 'error' }));
        if (!response.ok || !response.body) return response;
        const sse = response.headers.get('content-type')?.includes('text/event-stream');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let tail = '';
        let completed = false;
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const result = await reader.read();
              if (result.done) {
                if (completed) pending.delete(digest);
                controller.close();
                return;
              }
              tail += decoder.decode(result.value, { stream: true });
              if (sse && /(?:^|\r?\n\r?\n)data: ?\[DONE\]\r?\n\r?\n/.test(tail)) completed = true;
              tail = tail.slice(-128);
              controller.enqueue(result.value);
            } catch (error) { controller.error(error); }
          },
          cancel(reason) { return reader.cancel(reason); },
        });
        return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
      };
    },
    event: async (payload) => {
    try {
      const event = payload?.event;
      if (event?.type !== 'message.part.updated') return;
      const p = event.properties?.part;
      if (p?.type !== 'tool' || typeof p.sessionID !== 'string' || typeof p.callID !== 'string' || typeof p.tool !== 'string') return;
      const key = p.sessionID + ':' + p.callID;
      if (p.state?.status === 'completed' || p.state?.status === 'error') { seen.delete(key); return; }
      if (p.state?.status !== 'pending' && p.state?.status !== 'running') return;
      const input = p.state.input;
      const target = ['write', 'edit', 'read'].includes(p.tool) && typeof input?.filePath === 'string' ? input.filePath : undefined;
      const signature = p.tool + ':' + (target || '');
      if (seen.get(key) === signature) return;
      process.stdout.write(JSON.stringify({ type: 'od_opencode_tool', version: 1, sessionID: p.sessionID, callID: p.callID, tool: p.tool, path: target }) + '\n');
      seen.set(key, signature);
    } catch { /* Preview delivery cannot affect tool execution. */ }
  }};
}
`;

export function supportsOpenCodeEventPlugin(version: string | undefined): boolean {
  const match = /^1\.(\d+)\.(\d+)$/u.exec(version ?? '');
  return Boolean(match && (Number(match[1]) > 17 || (Number(match[1]) === 17 && Number(match[2]) >= 18)));
}

/** OpenCode waits for its own npm setup even for an import-free file plugin. */
function applyDependencyFetchDefaults(env: NodeJS.ProcessEnv): void {
  const defaults = { npm_config_fetch_retries: '0', npm_config_fetch_timeout: '10000' };
  for (const [key, value] of Object.entries(defaults)) {
    // npm accepts uppercase names too. Preserve explicit per-agent/shell env.
    if (!Object.keys(env).some(name => name.toLowerCase() === key && env[name] !== undefined)) env[key] = value;
  }
}

/** Mutates only this child's config overlay; dataDir is the daemon's resolved root. */
export async function applyOpenCodeEventPlugin(
  env: NodeJS.ProcessEnv,
  dataDir: string,
  version: string | undefined,
  inheritedConfigContent?: string,
): Promise<boolean> {
  if (!supportsOpenCodeEventPlugin(version) || /^(1|true)$/iu.test(env.OPENCODE_PURE ?? '')) return false;
  const config: unknown = env.OPENCODE_CONFIG_CONTENT ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const overlay = config as Record<string, unknown>;
  if (overlay.plugin !== undefined && !Array.isArray(overlay.plugin)) return false;
  const inherited: unknown = inheritedConfigContent ? JSON.parse(inheritedConfigContent) : {};
  const inheritedPlugins = inherited && typeof inherited === 'object' && 'plugin' in inherited && Array.isArray(inherited.plugin)
    ? inherited.plugin : [];
  const plugins = Array.isArray(overlay.plugin) ? overlay.plugin : [];
  const hash = createHash('sha256').update(OPEN_CODE_EVENT_PLUGIN_SOURCE).digest('hex').slice(0, 16);
  const dir = path.join(dataDir, 'agent-runtime', 'opencode', 'plugins');
  const file = path.join(dir, `tool-events-${hash}.mjs`);
  // Reuse verified content on subsequent turns; repair a truncated/modified
  // module before advertising it to the child.
  if (await readFile(file, 'utf8').catch(() => null) !== OPEN_CODE_EVENT_PLUGIN_SOURCE) {
    await mkdir(dir, { recursive: true });
    // Atomic replacement keeps concurrent launches from loading partial JS.
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, OPEN_CODE_EVENT_PLUGIN_SOURCE, { flag: 'wx', mode: 0o600 });
      try { await rename(temporary, file); }
      catch (error) {
        // Concurrent launches can publish the same content-addressed module.
        // Windows may reject the second rename while the first file is open.
        // Accept only the exact completed artifact; corruption still fails.
        if (!['EPERM', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '') ||
          await readFile(file, 'utf8').catch(() => null) !== OPEN_CODE_EVENT_PLUGIN_SOURCE) throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    ...overlay, plugin: [...new Set([...inheritedPlugins, ...plugins, pathToFileURL(file).href])],
  });
  applyDependencyFetchDefaults(env);
  return true;
}
