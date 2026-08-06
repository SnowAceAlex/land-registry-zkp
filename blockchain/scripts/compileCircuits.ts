/**
 * scripts/compileCircuits.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Compiles the three top-level circuits to R1CS + WASM + symbols and prints a
 * constraint-count table.
 *
 * Run: pnpm --filter blockchain run circuits:compile
 *
 * The constraint counts are a thesis deliverable (Chapter 5) and they also pick
 * the trusted-setup parameter: Powers-of-Tau must cover 2^k >= constraints, and
 * a larger .ptau than needed just wastes download and setup time.
 *
 * Templates under circuits/common/ are not compiled directly — they declare no
 * `component main`, so circom has no entry point for them. They are compiled
 * transitively as part of each circuit below, and MerkleProof(20) additionally
 * gets its own generated main in test/circuits/merkleProof.test.ts.
 *
 * ⚠️  circomlib resolves under blockchain/node_modules, NOT the workspace root
 *     (pnpm does not hoist it). Hence `-l node_modules` with cwd = blockchain/.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { BLOCKCHAIN_DIR } from './lib/paths';

const BUILD_DIR = path.join(BLOCKCHAIN_DIR, 'circuits', 'build');

/** Top-level circuits, cheapest first — a failure in ownership fails the rest too. */
const CIRCUITS = ['ownership', 'mortgage', 'transfer'] as const;

interface CircuitStats {
  name: string;
  nonLinear: number;
  linear: number;
  publicInputs: number;
  privateInputs: number;
  wires: number;
}

/**
 * Pull `label: 12345` out of circom's summary block.
 * Matched per line against the full label — a substring match would read
 * "non-linear constraints" when asked for "linear constraints".
 * circom colourises some lines, so strip ANSI escapes first.
 */
function readStat(output: string, label: string): number {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\[[0-9;]*m/g, '');
  for (const line of plain.split('\n')) {
    const [key, value] = line.split(':');
    if (value !== undefined && key.trim() === label) {
      // Some lines carry a trailing note, e.g.
      //   "private inputs: 45 (44 belong to witness)"
      // so take the leading integer rather than the whole value.
      return parseInt(value.trim(), 10);
    }
  }
  return 0;
}

function compile(name: string): CircuitStats {
  const outDir = path.join(BUILD_DIR, name);
  fs.mkdirSync(outDir, { recursive: true });

  const args = [
    path.join('circuits', `${name}.circom`),
    '--r1cs',
    '--wasm',
    '--sym',
    '-l',
    'node_modules',
    '-o',
    path.relative(BLOCKCHAIN_DIR, outDir),
  ];

  process.stdout.write(`  compiling ${name}.circom ... `);
  let output: string;
  try {
    // circom writes its summary to stdout and warnings to stderr; merge both so
    // a warning-only run still yields parseable stats.
    output = execFileSync('circom', args, {
      cwd: BLOCKCHAIN_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    process.stdout.write('FAILED\n\n');
    console.error(err.stdout ?? '');
    console.error(err.stderr ?? String(error));
    throw new Error(`circom failed to compile ${name}.circom`);
  }
  process.stdout.write('ok\n');

  return {
    name,
    nonLinear: readStat(output, 'non-linear constraints'),
    linear: readStat(output, 'linear constraints'),
    publicInputs: readStat(output, 'public inputs'),
    privateInputs: readStat(output, 'private inputs'),
    wires: readStat(output, 'wires'),
  };
}

/** Smallest Powers-of-Tau exponent covering `constraints`. */
function requiredPtauPower(constraints: number): number {
  let power = 8;
  while (2 ** power < constraints) power++;
  return power;
}

function main(): void {
  console.log(`\nCompiling circuits -> ${path.relative(BLOCKCHAIN_DIR, BUILD_DIR)}/\n`);

  const stats = CIRCUITS.map(compile);

  const pad = (value: string | number, width: number) => String(value).padStart(width);
  console.log('\n  circuit    non-linear   linear   public   private    wires   min .ptau');
  console.log('  ─────────────────────────────────────────────────────────────────────');
  for (const s of stats) {
    const total = s.nonLinear + s.linear;
    console.log(
      `  ${s.name.padEnd(9)}${pad(s.nonLinear, 11)}${pad(s.linear, 9)}` +
        `${pad(s.publicInputs, 9)}${pad(s.privateInputs, 10)}${pad(s.wires, 9)}` +
        `${pad(`2^${requiredPtauPower(total)}`, 12)}`,
    );
  }

  const maxPower = requiredPtauPower(Math.max(...stats.map((s) => s.nonLinear + s.linear)));
  console.log(
    `\n  Trusted setup (Phase 3) needs powersOfTau28_hez_final_${maxPower}.ptau or larger.\n`,
  );
}

main();
