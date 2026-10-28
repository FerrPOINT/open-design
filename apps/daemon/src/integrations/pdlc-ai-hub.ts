import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pdlcAuthOrigin } from '../http/pdlc-config.js';
import { buildOpenCodeByokProviderConfig } from '../runtimes/byok-opencode.js';

/** Installation-owned inference. Never accept the Hub URL, key or model from a run body. */
export function pdlcAiHubProvider(dataDir: string, pdlcMode: boolean) {
  if (!pdlcMode) return null;
  // Follow the daemon's existing private integration-config pattern, using its
  // already resolved data root; never infer a second installation directory.
  let config: { origin?: unknown; model?: unknown; key?: unknown };
  try { config = JSON.parse(readFileSync(path.join(dataDir, 'pdlc-ai-hub.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('PDLC AI Hub private configuration is unavailable or invalid');
  }
  if (!config || typeof config.origin !== 'string' || !config.origin.trim()) throw new Error('PDLC AI Hub origin is required');
  const origin = pdlcAuthOrigin(config.origin, '');
  const model = config.model;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) {
    throw new Error('PDLC AI Hub model must be a published virtual model slug');
  }
  const key = config.key;
  if (typeof key !== 'string' || !/^aih1_[a-f0-9]{64}$/.test(key)) throw new Error('PDLC AI Hub key is invalid');
  const provider = buildOpenCodeByokProviderConfig({
    protocol: 'openai', baseUrl: `${origin}/v1`, apiKey: key,
  }, model)!;
  // Both the main agent and its small utility calls use the same admitted Hub model.
  provider.config = {
    ...provider.config,
    model: provider.modelId, small_model: provider.modelId,
    enabled_providers: [provider.providerId],
  };
  provider.env.OD_PDLC_AI_HUB_PROVIDER = provider.providerId;
  // The image filesystem is read-only and its service user has no writable
  // home. CLI state, cache and configuration belong to this installation.
  const runtimeRoot = path.join(dataDir, 'agent-runtime', 'opencode');
  for (const kind of ['DATA', 'CACHE', 'CONFIG', 'STATE']) {
    provider.env[`XDG_${kind}_HOME`] = path.join(runtimeRoot, kind.toLowerCase());
  }
  provider.env.OPENCODE_DISABLE_MODELS_FETCH = 'true';
  provider.env.OPENCODE_DISABLE_AUTOUPDATE = 'true';
  return provider;
}
