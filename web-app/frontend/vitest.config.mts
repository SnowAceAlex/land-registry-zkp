import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Unit tests for pure logic only (D57): error mapping, bundle parsing, the draft
 * step machine, the counter's seller checks and witness assembly. Nothing here
 * renders a component or talks to a chain — those paths are covered by
 * PHASE_8_MANUAL_TEST.md against a live node and wallet.
 *
 * Node environment on purpose: the crypto under test (Poseidon, WebCrypto
 * SHA-256) runs identically there, and a DOM would only slow it down.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@land-registry/blockchain/shared': path.resolve(
        import.meta.dirname,
        '../../blockchain/shared/index.ts',
      ),
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
