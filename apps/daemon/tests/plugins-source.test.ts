import { expect, test } from 'vitest';
import { isLocalPluginSource } from '../src/plugins/installer.js';

test.each(['C:\\design\\plugin', 'C:/design/plugin', '\\\\server\\share\\plugin', '.\\plugin', '..\\plugin'])(
  'Windows daemon recognizes local plugin source %s', source => {
    expect(isLocalPluginSource(source, 'win32')).toBe(true);
  });
test.each(['linux', 'win32'] as const)('local and marketplace sources stay distinct on %s', platform => {
  for (const source of ['/opt/plugin', './plugin', '../plugin', '~/plugin']) {
    expect(isLocalPluginSource(source, platform)).toBe(true);
  }
  for (const source of ['plugin-name', 'org/plugin', 'github:org/repo', 'https://example.test/plugin.tgz']) {
    expect(isLocalPluginSource(source, platform)).toBe(false);
  }
});
test('a Windows client path does not become a local source on a Linux daemon', () => {
  expect(isLocalPluginSource('C:\\design\\plugin', 'linux')).toBe(false);
});
