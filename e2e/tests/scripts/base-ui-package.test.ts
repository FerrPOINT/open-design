import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { pinnedBaseUiSpec } from '../../../scripts/lib/guard/base-ui-package.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('accepts immutable Base bytes and rejects changed bytes, stale revision and unpinned archives', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-base-pin-'));
  roots.push(root);
  await mkdir(path.join(root, 'vendor'));
  const revision = 'a'.repeat(40), fingerprint = 'b'.repeat(64), bytes = Buffer.from('package fixture');
  const archive = `pdlc-ui-0.3.0-${fingerprint.slice(0, 12)}.tgz`;
  const pin = { version: '0.3.0', revision, fingerprint, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(path.join(root, '.base-ui-revision'), revision);
  await writeFile(path.join(root, 'vendor', archive), bytes);
  expect(await pinnedBaseUiSpec(root)).toBeNull();
  await writeFile(path.join(root, 'vendor/base-ui.json'), JSON.stringify(pin));
  expect(await pinnedBaseUiSpec(root)).toBe(`file:../../vendor/${archive}`);
  await writeFile(path.join(root, 'vendor', archive), 'modified package');
  expect(await pinnedBaseUiSpec(root)).toBeNull();
  await writeFile(path.join(root, 'vendor', archive), bytes);
  await writeFile(path.join(root, '.base-ui-revision'), 'c'.repeat(40));
  expect(await pinnedBaseUiSpec(root)).toBeNull();
});
