import { readFileSync } from 'node:fs';
import { pdlcAuthOrigin } from '../http/pdlc-config.js';
import { buildOpenCodeByokProviderConfig } from '../runtimes/byok-opencode.js';

/** Installation-owned inference. Never accept the Hub URL, key or model from a run body. */
export function pdlcAiHubProvider(env: NodeJS.ProcessEnv = process.env) {
  const names = ['OD_PDLC_AI_HUB_URL', 'OD_PDLC_AI_HUB_KEY_FILE', 'OD_PDLC_AI_HUB_MODEL'];
  if (!names.some(name => env[name])) return null;
  if (!env.OD_PDLC_AUTH_ISSUER || names.some(name => !env[name]?.trim())) {
    throw new Error('PDLC AI Hub requires Central Auth, URL, model and a private key file');
  }
  const origin = pdlcAuthOrigin(env.OD_PDLC_AI_HUB_URL, '');
  const model = env.OD_PDLC_AI_HUB_MODEL!;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) {
    throw new Error('PDLC AI Hub model must be a published virtual model slug');
  }
  // Do not include the path, file contents or filesystem error in diagnostics.
  let key: string;
  try { key = readFileSync(env.OD_PDLC_AI_HUB_KEY_FILE!, 'utf8').trim(); }
  catch { throw new Error('PDLC AI Hub key file is unavailable'); }
  if (!/^aih1_[a-f0-9]{64}$/.test(key)) throw new Error('PDLC AI Hub key file is invalid');
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
  return provider;
}
