/**
 * test/shared/browserSafety.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The shared barrel is bundled into the browser: the government portal proves
 * transfers at the counter (Phase 8) and the resident portal proves and
 * verifies (Phase 9). Two import shapes break that, and neither shows up in any
 * Node test — they only fail `next build`:
 *
 *   - a `node:` scheme specifier (static OR dynamic): webpack's client build
 *     cannot read it at all — "UnhandledSchemeError: Reading from node:fs".
 *     This is exactly what zkpHelper's `await import('node:fs')` did, while its
 *     own comment claimed the barrel was browser-safe.
 *   - a static import of a Node-only built-in (`fs`, `crypto`): pulled into the
 *     client graph for code the browser never runs. These modules load them
 *     lazily with `require()` inside the function that needs them, which the
 *     frontend's webpack fallback resolves to an empty module.
 *
 * So this reads the source instead of importing it: what is under test is the
 * import graph the browser bundler will see.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const SHARED_DIR = path.resolve(__dirname, '../../shared');
const NODE_ONLY_BUILTINS = ['fs', 'crypto', 'child_process', 'os', 'worker_threads'];

function sharedSources(): Array<{ file: string; source: string }> {
  return fs
    .readdirSync(SHARED_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map((file) => ({ file, source: fs.readFileSync(path.join(SHARED_DIR, file), 'latin1') }));
}

describe('blockchain/shared stays bundleable for the browser (Phase 8/9)', () => {
  it('never uses a node: scheme specifier, static or dynamic', () => {
    const offenders = sharedSources().flatMap(({ file, source }) =>
      [...source.matchAll(/(?:from\s+|import\(\s*|require\(\s*)['"]node:[^'"]+['"]/g)].map(
        (match) => `${file}: ${match[0]}`,
      ),
    );

    expect(offenders).to.deep.equal([]);
  });

  it('never statically imports a Node-only built-in', () => {
    const offenders = sharedSources().flatMap(({ file, source }) =>
      NODE_ONLY_BUILTINS.filter((builtin) =>
        new RegExp(`^import[^;]*from\\s+['"]${builtin}['"]`, 'm').test(source),
      ).map((builtin) => `${file}: static import of '${builtin}'`),
    );

    expect(offenders).to.deep.equal([]);
  });

  /**
   * These three are imported DIRECTLY, by subpath, from browser pages that do
   * no cryptography at all: `/resident/lookup` needs the id range,
   * `/resident/verify` needs the leaf field list to say which fields a proof
   * never revealed (D67) and the calldata formatter to make an `eth_call`.
   *
   * Each is split out of a module that imports something large at the top
   * level — `merkleTree.ts` pulls circomlibjs, `zkpHelper.ts` pulls snarkjs.
   * Measured: `/resident/lookup` was 3.7 MB before the first split and 0.6 MB
   * after; `/resident/verify` was 4.1 MB before the calldata split.
   *
   * One runtime import added to either file would quietly put all of that
   * back, and only a bundle measurement would notice. Type-only imports are
   * fine: they are erased before the bundler ever sees them.
   */
  for (const file of [
    'treeDimensions.ts',
    'leafFields.ts',
    'solidityCalldata.ts',
    'statusAttestation.ts',
  ]) {
    it(`keeps ${file} free of runtime imports, so a page can read it cheaply`, () => {
      const source = fs.readFileSync(path.join(SHARED_DIR, file), 'latin1');
      const runtimeImports = [
        ...source.matchAll(/^\s*import\b(?!\s+type\b)[^;]*;/gm),
        ...source.matchAll(/^\s*export\s+(?!type\b)[^;]*\bfrom\b[^;]*;/gm),
        ...source.matchAll(/\brequire\(/g),
      ].map((match) => match[0].trim());

      expect(runtimeImports).to.deep.equal([]);
    });
  }
});
