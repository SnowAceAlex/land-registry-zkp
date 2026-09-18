import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Unit tests for pure logic only (D57): error mapping, bundle and proof-file
 * parsing, the step machines, the counter's seller checks and witness assembly,
 * the resident chain-config and history helpers. Nothing here renders a
 * component or talks to a chain — those paths are covered by
 * PHASE_8_MANUAL_TEST.md and PHASE_9_MANUAL_TEST.md against a live node.
 *
 * Node environment on purpose: the crypto under test (Poseidon, WebCrypto
 * SHA-256) runs identically there, and a DOM would only slow it down.
 *
 * Aliases are the ARRAY form, because order matters: Vite applies string
 * aliases as prefixes, so the bare `.../shared` entry would rewrite
 * `.../shared/treeDimensions` to `index.ts/treeDimensions`. The subpath rule
 * has to be matched first, and a regex makes that explicit.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@land-registry\/blockchain\/shared\/(.+)$/,
        replacement: path.resolve(import.meta.dirname, '../../blockchain/shared/$1.ts'),
      },
      {
        find: '@land-registry/blockchain/shared',
        replacement: path.resolve(import.meta.dirname, '../../blockchain/shared/index.ts'),
      },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'src') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
