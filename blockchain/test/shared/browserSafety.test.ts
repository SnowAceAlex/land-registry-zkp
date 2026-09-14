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
});
