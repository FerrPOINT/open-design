import type { PdlcConfiguration } from '@open-design/contracts';

function urlSetting(value: string | undefined, name: string, originOnly = false): string {
  if (!value) throw new Error(`${name} is required in PDLC mode`);
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
    url.search || url.hash || (originOnly && url.pathname !== '/') ||
    (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) throw new Error(`${name} must be an HTTPS URL (HTTP is limited to loopback)`);
  return originOnly ? url.origin : url.href;
}

/** A partial configuration fails startup instead of reopening legacy local auth. */
export function pdlcConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): PdlcConfiguration | null {
  const names = [
    'OD_PDLC_AUTH_ISSUER', 'OD_PDLC_CLIENT_ID', 'OD_PDLC_PUBLIC_ORIGIN',
    'OD_PDLC_HOST_ORIGIN', 'OD_PDLC_CATALOG_URL',
  ];
  if (!names.some((name) => env[name] !== undefined && env[name] !== '')) return null;
  const clientId = env.OD_PDLC_CLIENT_ID;
  if (!clientId || !/^[a-zA-Z0-9-]{1,64}$/.test(clientId)) {
    throw new Error('OD_PDLC_CLIENT_ID must be a registered OIDC client ID');
  }
  return {
    issuer: urlSetting(env.OD_PDLC_AUTH_ISSUER, 'OD_PDLC_AUTH_ISSUER', true),
    clientId,
    publicOrigin: urlSetting(env.OD_PDLC_PUBLIC_ORIGIN, 'OD_PDLC_PUBLIC_ORIGIN', true),
    hostOrigin: env.OD_PDLC_HOST_ORIGIN
      ? urlSetting(env.OD_PDLC_HOST_ORIGIN, 'OD_PDLC_HOST_ORIGIN', true) : null,
    catalogUrl: env.OD_PDLC_CATALOG_URL
      ? urlSetting(env.OD_PDLC_CATALOG_URL, 'OD_PDLC_CATALOG_URL') : null,
    applicationKey: 'open-design',
  };
}
