import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import type { PdlcInferenceStatus } from '@open-design/contracts';
import { pdlcAuthOrigin } from '../http/pdlc-config.js';
import { isLoopbackHost } from '../http/loopback-url.js';
import { buildOpenCodeByokProviderConfig } from '../runtimes/byok-opencode.js';
import { proxyDispatcherRequestInit } from '../connectionTest.js';

/** Installation-owned inference. Never accept its URL, key or model from a run body. */
export function pdlcAiHubProvider(dataDir: string, pdlcMode: boolean) {
  if (!pdlcMode) return null;
  // Follow the daemon's existing private integration-config pattern, using its
  // already resolved data root; never infer a second installation directory.
  let config: { transport?: unknown; baseUrl?: unknown; allowInsecurePrivateHttp?: unknown; origin?: unknown; model?: unknown; key?: unknown; proxyUrl?: unknown };
  let direct = false;
  try {
    try {
      config = JSON.parse(readFileSync(path.join(dataDir, 'pdlc-inference.json'), 'utf8'));
      direct = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      config = JSON.parse(readFileSync(path.join(dataDir, 'pdlc-ai-hub.json'), 'utf8'));
    }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('PDLC inference private configuration is unavailable or invalid');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('PDLC inference configuration is invalid');
  let baseUrl: string;
  if (direct) {
    if (config.transport !== 'openai-compatible' || typeof config.baseUrl !== 'string') throw new Error('PDLC inference transport or base URL is invalid');
    let url: URL;
    try { url = new URL(config.baseUrl); }
    catch { throw new Error('PDLC inference base URL is invalid'); }
    const octets = url.hostname.split('.').map(Number);
    const privateIp = isIP(url.hostname) === 4 && (octets[0] === 10 ||
      (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) || (octets[0] === 192 && octets[1] === 168));
    if (config.baseUrl.trim() !== config.baseUrl || url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && (isLoopbackHost(url.hostname) ||
        (privateIp && config.allowInsecurePrivateHttp === true))))) throw new Error('PDLC inference requires HTTPS or explicitly allowed private HTTP');
    baseUrl = url.href.replace(/\/$/, '');
  } else {
    if (typeof config.origin !== 'string' || !config.origin.trim()) throw new Error('PDLC AI Hub origin is required');
    baseUrl = `${pdlcAuthOrigin(config.origin, '')}/v1`;
  }
  const model = config.model;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) {
    throw new Error('PDLC AI Hub model must be a published virtual model slug');
  }
  const key = config.key;
  if (typeof key !== 'string' || (direct ? !key.trim() || key.length > 8192 || /[\s\x00-\x1f\x7f]/.test(key) : !/^aih1_[a-f0-9]{64}$/.test(key))) throw new Error('PDLC inference key is invalid');
  let proxyUrl: string | undefined;
  if (direct && config.proxyUrl !== undefined) {
    try {
      if (typeof config.proxyUrl !== 'string' || config.proxyUrl.trim() !== config.proxyUrl) throw new Error();
      const proxy = new URL(config.proxyUrl);
      if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password ||
        proxy.pathname !== '/' || proxy.search || proxy.hash) throw new Error();
      proxyUrl = proxy.origin;
    } catch { throw new Error('PDLC inference proxy URL is invalid'); }
  }
  const provider = buildOpenCodeByokProviderConfig({
    protocol: 'openai', baseUrl, apiKey: key,
  }, model)!;
  // Both the main agent and its small utility calls use the installation's model.
  provider.config = {
    ...provider.config,
    model: provider.modelId, small_model: provider.modelId,
    enabled_providers: [provider.providerId],
  };
  provider.env.OD_PDLC_INFERENCE_PROVIDER = provider.providerId;
  // Only the managed provider fetch uses this proxy; local tools/Auth keep their transport.
  if (proxyUrl) provider.env.OD_PDLC_INFERENCE_PROXY = proxyUrl;
  // The image filesystem is read-only and its service user has no writable
  // home. CLI state, cache and configuration belong to this installation.
  const runtimeRoot = path.join(dataDir, 'agent-runtime', 'opencode');
  for (const kind of ['DATA', 'CACHE', 'CONFIG', 'STATE']) {
    provider.env[`XDG_${kind}_HOME`] = path.join(runtimeRoot, kind.toLowerCase());
  }
  provider.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
  provider.env.OPENCODE_DISABLE_AUTOUPDATE = 'true';
  return { ...provider, catalogUrl: `${baseUrl}/models`, hubModel: model };
}

export async function pdlcInferenceStatus(
  provider: ReturnType<typeof pdlcAiHubProvider>,
  request: typeof fetch = fetch,
): Promise<PdlcInferenceStatus> {
  if (!provider) return { state: 'not_configured', model: null };
  const model = provider.hubModel;
  const proxyUrl = provider.env.OD_PDLC_INFERENCE_PROXY;
  // Reuse the native connection-check transport and release its pool after the check.
  const proxy = proxyUrl ? proxyDispatcherRequestInit({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: '' }) : null;
  try {
    const response = await request(provider.catalogUrl, {
      ...proxy?.requestInit,
      headers: { Authorization: `Bearer ${provider.env.OPEN_DESIGN_BYOK_API_KEY}` },
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { state: response.status === 401 || response.status === 403 ? 'access_denied' : 'hub_unavailable', model };
    }
    const body = await response.json() as { data?: Array<{ id?: string }> };
    if (!Array.isArray(body.data)) return { state: 'hub_unavailable', model };
    return { state: body.data.some(item => item?.id === model) ? 'ready' : 'model_unavailable', model };
  } catch { return { state: 'hub_unavailable', model }; }
  finally { await proxy?.close(); }
}
