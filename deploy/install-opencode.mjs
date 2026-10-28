// Pin the official musl CLI and verify its npm integrity before unpacking it.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const integrity = {
  x64: '7LeMsIfPu1/sEVAUCXRCAk1htCKdRKmrPR5lQvG9NCkxoerpQE6m89eJTRqDQrYWUcHWtVmqo0fwdHdR4MnYcA==',
  arm64: 'IQedvhqaisv886gwk3bR603fPTErdExQa0z3hmqi7waIeuSsQG9B+suhg6iaD74lmxMbYMRlPlg4kIioytiHGg==',
}[process.arch];
if (!integrity) throw new Error('Unsupported OpenCode container architecture');
const name = `opencode-linux-${process.arch}-musl`;
const response = await fetch(`https://registry.npmjs.org/${name}/-/${name}-1.18.30.tgz`, {
  redirect: 'error', signal: AbortSignal.timeout(120_000),
});
if (!response.ok) throw new Error(`OpenCode download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha512').update(bytes).digest('base64') !== integrity) {
  throw new Error('OpenCode integrity mismatch');
}
writeFileSync('/tmp/opencode.tgz', bytes);
