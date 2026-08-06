import * as fs from 'fs';
import * as path from 'path';

/**
 * paths.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Locates the monorepo root by walking up for pnpm-workspace.yaml.
 *
 * Counting `..` segments from __dirname does not work here: the same source
 * file sits at src/<module>/ under ts-node and Jest, but at
 * dist/web-app/backend/src/<module>/ once compiled, so any fixed number of
 * segments is wrong in one of the two. Searching for a marker file is correct
 * in both.
 *
 * The backend reads two things from outside its own package: the deployment
 * records written by scripts/deploy.ts, and the circuit verification keys
 * produced by the trusted setup.
 */

let cachedRepoRoot: string | undefined;

export function repoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot;

  let current = __dirname;
  for (let depth = 0; depth < 12; depth++) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      cachedRepoRoot = current;
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `Could not locate the monorepo root (no pnpm-workspace.yaml above ${__dirname})`,
  );
}

/** blockchain/ — holds deployments/<network>.json and circuits/build/. */
export function blockchainDir(): string {
  return path.join(repoRoot(), 'blockchain');
}

/** web-app/backend/ — holds certs/ (issuer X.509 identity). */
export function backendDir(): string {
  return path.join(repoRoot(), 'web-app', 'backend');
}
