import { randomUUID } from 'node:crypto';
import { isLoopbackHost } from './http/loopback-url.js';

const targets = new Set<string>();

/** Only explicit CLI/discovered daemon targets may receive the platform credential. */
export function rememberDaemonUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname)))) {
    throw new Error('Daemon URL must use HTTPS or loopback HTTP without credentials');
  }
  targets.add(url.href.replace(/\/$/, ''));
  return value;
}

/** One transport for CLI/MCP HTTP. Does not alter global fetch or browser credentials. */
export async function daemonFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const scoped = [...targets].some(target => url.href === target || url.href.startsWith(target + '/'));
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const token = process.env.PDLC_API_TOKEN;
  if (scoped && token && !headers.has('authorization')) headers.set('Authorization', `Bearer ${token}`);
  if (scoped && !headers.has('x-request-id')) headers.set('X-Request-ID', `od-cli-${randomUUID()}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  timer.unref();
  try {
    return await globalThis.fetch(input, { ...init, headers,
      ...(scoped || headers.has('authorization') ? { redirect: 'error' as const } : {}),
      signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
    });
  } catch {
    // Network errors may contain URLs/credentials; never reproduce them in CLI output.
    throw new Error('HTTP request failed or timed out; check the selected endpoint and its availability');
  } finally { clearTimeout(timer); }
}
