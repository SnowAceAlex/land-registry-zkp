/**
 * scripts/circuits/syncFrontendArtifacts.ts   (pnpm --filter blockchain run circuits:sync-frontend)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 (D55) — copy each circuit's browser proving artifacts from
 * circuits/build/<name>/ into web-app/frontend/public/circuits/<name>/, where
 * the frontend's Web Worker fetches them:
 *
 *   <name>_js/<name>.wasm     → <name>.wasm
 *   <name>.zkey               → <name>.zkey
 *   verification_key.json     → verification_key.json
 *
 * Same reasoning as verifiers:sync (D32): the .zkey is regenerated with fresh
 * entropy on every circuits:setup, so a copy left over from an earlier setup
 * produces proofs the on-chain verifier rejects — and nothing in that failure
 * points at a stale file in public/. The destination is therefore GITIGNORED
 * and circuits:setup runs this sync automatically; run circuits:sync-frontend
 * on its own to re-copy without redoing the setup.
 *
 * Every source is checked before anything is written, so a failed sync leaves
 * the previous set intact rather than half-replaced with a mismatched pair.
 */

import * as fs from 'fs';
import * as path from 'path';

import { BLOCKCHAIN_DIR, buildDirFor } from '../lib/paths';
import { CIRCUIT_NAMES } from './syncVerifiers';

type CircuitName = (typeof CIRCUIT_NAMES)[number];

/** web-app/frontend/public/circuits — served statically at /circuits/ by Next.js. */
export const FRONTEND_CIRCUITS_DIR = path.resolve(
  BLOCKCHAIN_DIR,
  '..',
  'web-app',
  'frontend',
  'public',
  'circuits',
);

/**
 * Copy one circuit's artifacts. Returns the destination paths, in the order
 * wasm, zkey, verification key. `dirs` exists for tests; scripts use the
 * defaults.
 */
export function syncFrontendArtifacts(
  circuit: CircuitName,
  dirs: { buildDir?: string; destinationRoot?: string } = {},
): string[] {
  const buildDir = dirs.buildDir ?? buildDirFor(circuit);
  const destination = path.join(dirs.destinationRoot ?? FRONTEND_CIRCUITS_DIR, circuit);

  const copies: Array<[source: string, target: string]> = [
    [path.join(buildDir, `${circuit}_js`, `${circuit}.wasm`), `${circuit}.wasm`],
    [path.join(buildDir, `${circuit}.zkey`), `${circuit}.zkey`],
    [path.join(buildDir, 'verification_key.json'), 'verification_key.json'],
  ];

  const missing = copies.map(([source]) => source).filter((source) => !fs.existsSync(source));
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.map((source) => path.basename(source)).join(', ')} for ${circuit} ` +
        `(looked in ${buildDir}). Run "pnpm --filter blockchain run circuits:setup" first.`,
    );
  }

  fs.mkdirSync(destination, { recursive: true });
  return copies.map(([source, target]) => {
    const targetPath = path.join(destination, target);
    fs.copyFileSync(source, targetPath);
    return targetPath;
  });
}

/** Sync all three circuits; returns every destination path. */
export function syncAllFrontendArtifacts(): string[] {
  return CIRCUIT_NAMES.flatMap((circuit) => syncFrontendArtifacts(circuit));
}

if (require.main === module) {
  try {
    for (const destination of syncAllFrontendArtifacts()) {
      console.log(`synced → ${path.relative(path.resolve(BLOCKCHAIN_DIR, '..'), destination)}`);
    }
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
