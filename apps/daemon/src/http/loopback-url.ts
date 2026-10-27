import { isIP } from 'node:net';

/** HTTP is local-only; the platform uses distinct addresses within 127/8. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '[::1]' ||
    (isIP(host) === 4 && host.split('.')[0] === '127');
}
