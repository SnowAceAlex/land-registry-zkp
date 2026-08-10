/**
 * scripts/lib/paths.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Where the `blockchain/` package root is, computed once.
 *
 * Five scripts each derived this with `path.resolve(__dirname, …)`, and because
 * they sit at different nesting depths the literal differed ('..' vs '../..').
 * That works right up until a file moves between folders, at which point the
 * constant silently points one level off and every artifact path built from it
 * misses — reported as a missing .zkey rather than as a wrong base directory.
 *
 * Resolving from this file's own known location removes the per-caller
 * arithmetic: scripts/lib/ → scripts/ → blockchain/.
 */

import * as path from 'path';

/** Absolute path to the `blockchain/` package root. */
export const BLOCKCHAIN_DIR = path.resolve(__dirname, '../..');

/** `blockchain/circuits/build/<circuit>/` — compile + trusted-setup artifacts. */
export function buildDirFor(circuit: string): string {
  return path.join(BLOCKCHAIN_DIR, 'circuits', 'build', circuit);
}
