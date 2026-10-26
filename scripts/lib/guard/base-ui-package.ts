import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Base is a private package: accept only its reviewed, content-pinned archive. */
export async function pinnedBaseUiSpec(repoRoot: string): Promise<string | null> {
  try {
    const pin = JSON.parse(await readFile(path.join(repoRoot, 'vendor/base-ui.json'), 'utf8')) as Record<string, unknown>;
    const revision = (await readFile(path.join(repoRoot, '.base-ui-revision'), 'utf8')).trim();
    if (typeof pin.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin.version) ||
      typeof pin.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(pin.fingerprint) ||
      typeof pin.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.sha256) ||
      !/^[a-f0-9]{40}$/.test(revision) || pin.revision !== revision) return null;
    const archive = `pdlc-ui-${pin.version}-${pin.fingerprint.slice(0, 12)}.tgz`;
    const bytes = await readFile(path.join(repoRoot, 'vendor', archive));
    if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) return null;
    return `file:../../vendor/${archive}`;
  } catch { return null; }
}
