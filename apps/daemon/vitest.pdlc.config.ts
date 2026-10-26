import { defineConfig } from 'vitest/config';

// HTTP boundary tests do not import the daemon/CLI composition root. Keep this
// scoped lane independent of setup.ts's full CLI build and native database.
export default defineConfig({
  test: {
    environment: 'node', fileParallelism: false,
    include: ['tests/http/pdlc-*.test.ts', 'tests/tool-tokens.test.ts', 'tests/plugin-asset-workspace-authority.test.ts', 'tests/origin-validation.test.ts'],
    testTimeout: 5000,
  },
});
