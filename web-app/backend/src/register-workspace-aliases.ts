/**
 * register-workspace-aliases.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Must be the FIRST import in main.ts.
 *
 * `@land-registry/blockchain` publishes TypeScript source, not compiled JS —
 * the frontend transpiles it through Next and the blockchain scripts run under
 * ts-node. The backend compiles with tsc, which keeps the import specifiers
 * as-is: at runtime Node then resolves `@land-registry/blockchain/shared`
 * through node_modules to the raw `.ts` file and dies on the first type
 * annotation.
 *
 * tsc already emitted those sources into dist/blockchain/** (rootDir is pinned
 * to the monorepo root for exactly this reason), so the fix is to point the two
 * subpath specifiers at that compiled output. The hook falls through whenever
 * the compiled file is absent, which is what makes ts-node and Jest — where
 * tsconfig paths and moduleNameMapper already resolve these — behave normally.
 */

import * as fs from 'fs';
import * as path from 'path';

type ResolveFilename = (request: string, ...rest: unknown[]) => string;

// dist/web-app/backend/src → dist
const distRoot = path.resolve(__dirname, '..', '..', '..');

const aliases: Record<string, string> = {
  '@land-registry/blockchain/shared': path.join(distRoot, 'blockchain', 'shared', 'index.js'),
  '@land-registry/blockchain/typechain-types': path.join(
    distRoot,
    'blockchain',
    'typechain-types',
    'index.js',
  ),
};

// Must be require(): this patches module resolution, so it has to run before
// anything it affects is resolved — an ESM import would be hoisted above it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ModuleCtor = require('module') as { _resolveFilename: ResolveFilename };
const originalResolveFilename = ModuleCtor._resolveFilename;

ModuleCtor._resolveFilename = function (request: string, ...rest: unknown[]): string {
  const compiled = aliases[request];
  if (compiled && fs.existsSync(compiled)) {
    return originalResolveFilename.call(this, compiled, ...rest);
  }
  return originalResolveFilename.call(this, request, ...rest);
} as ResolveFilename;
