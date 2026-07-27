/**
 * scripts/setup/trustedSetup.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable Groth16 Phase-2 trusted-setup helpers, shared by circuits:setup
 * (setupAll.ts — all three circuits) and circuits:smoke (smokeOwnership.ts —
 * ownership only). One code path for ptau + setup so the two entry points can
 * never drift.
 *
 * D13: Powers of Tau (Phase 1) is the PUBLIC Hermez/iden3 ceremony — downloaded,
 * cached under blockchain/ptau/ (gitignored, reproducible), never re-run here.
 * Only the circuit-specific Phase 2 runs locally, with a SINGLE throwaway
 * contribution. This is deliberately NOT a real multi-party ceremony; the PoC
 * limitation is called out in the thesis.
 *
 * ⚠️  snarkjs leaves worker threads running — the CLI entry points that use this
 *     module (setupAll.ts, smokeOwnership.ts) must process.exit() explicitly.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as snarkjs from 'snarkjs';

/** Root of the blockchain/ package — build artifacts and ptau live under here. */
export const BLOCKCHAIN_DIR = path.resolve(__dirname, '../..');
const PTAU_DIR = path.join(BLOCKCHAIN_DIR, 'ptau');
const PTAU_BASE_URL = 'https://storage.googleapis.com/zkevm/ptau';

export interface CircuitSetupResult {
  info: snarkjs.R1csInfo;
  /** Powers-of-Tau exponent actually used. */
  power: number;
  paths: {
    zkeyPath: string;
    vkeyPath: string;
    verifierSolPath: string;
  };
}

/** circuits/build/<circuit>/ — where compile + setup artifacts land. */
export function buildDirFor(circuit: string): string {
  return path.join(BLOCKCHAIN_DIR, 'circuits', 'build', circuit);
}

/** Smallest Powers-of-Tau exponent whose domain covers this circuit. */
export function ptauPowerFor(info: snarkjs.R1csInfo): number {
  const needed = info.nConstraints + info.nPubInputs + info.nOutputs;
  let power = 8;
  while (2 ** power < needed) power++;
  return power;
}

/**
 * Fetch the public ptau if it isn't cached. blockchain/ptau/*.ptau is
 * gitignored — this is a large, reproducible public artifact, not source.
 */
export async function ensurePtau(power: number): Promise<string> {
  const fileName = `powersOfTau28_hez_final_${power}.ptau`;
  const destination = path.join(PTAU_DIR, fileName);

  if (fs.existsSync(destination)) {
    const sizeMb = (fs.statSync(destination).size / 1024 / 1024).toFixed(1);
    console.log(`  cached: ptau/${fileName} (${sizeMb} MB)`);
    return destination;
  }

  const url = `${PTAU_BASE_URL}/${fileName}`;
  console.log(`  downloading ${url}`);
  fs.mkdirSync(PTAU_DIR, { recursive: true });

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const expectedMb = (Number(response.headers.get('content-length') ?? 0) / 1024 / 1024).toFixed(1);
  console.log(`  size: ${expectedMb} MB — this runs once, the file is cached`);

  // Stream to a temp name and rename on success, so an interrupted download
  // doesn't leave a truncated file that looks cached on the next run.
  const partial = `${destination}.part`;
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(partial),
  );
  fs.renameSync(partial, destination);

  return destination;
}

/** contract Groth16VerifierOwnership / ...Mortgage / ...Transfer, per file. */
function verifierFileName(circuit: string): string {
  return `Groth16Verifier${circuit.charAt(0).toUpperCase()}${circuit.slice(1)}`;
}

/**
 * Run the full circuit-specific Phase-2 setup for one circuit:
 *   newZKey → contribute (one local contribution) → export verification_key.json
 *   + Groth16Verifier<Name>.sol, all into circuits/build/<circuit>/.
 *
 * Consumes circuits/build/<circuit>/<circuit>.r1cs + the compiled WASM — run
 * `pnpm --filter blockchain run circuits:compile` first.
 *
 * The exported .sol keeps snarkjs's default `contract Groth16Verifier` name;
 * syncVerifiers.ts relocates/renames it into contracts/verifiers/ for the
 * on-chain dispatcher (the copy under build/ is not compiled by Hardhat).
 */
export async function setupCircuit(circuit: string): Promise<CircuitSetupResult> {
  const buildDir = buildDirFor(circuit);
  const r1csPath = path.join(buildDir, `${circuit}.r1cs`);
  const wasmPath = path.join(buildDir, `${circuit}_js`, `${circuit}.wasm`);
  if (!fs.existsSync(r1csPath) || !fs.existsSync(wasmPath)) {
    throw new Error(
      `Missing build output for ${circuit}. ` +
        `Run "pnpm --filter blockchain run circuits:compile" first.`,
    );
  }

  const zkeyInitPath = path.join(buildDir, `${circuit}_0000.zkey`);
  const zkeyFinalPath = path.join(buildDir, `${circuit}.zkey`);
  const vkeyPath = path.join(buildDir, 'verification_key.json');
  const verifierSolPath = path.join(buildDir, `${verifierFileName(circuit)}.sol`);

  const info = await snarkjs.r1cs.info(r1csPath);
  const power = ptauPowerFor(info);
  console.log(
    `  constraints: ${info.nConstraints}  public: ${info.nPubInputs}  ` +
      `private: ${info.nPrvInputs}  → 2^${power}`,
  );

  const ptauPath = await ensurePtau(power);

  await snarkjs.zKey.newZKey(r1csPath, ptauPath, zkeyInitPath);
  // One local contribution with throwaway entropy (D13). A real ceremony needs
  // multiple independent contributors; called out as a limitation in the thesis.
  await snarkjs.zKey.contribute(
    zkeyInitPath,
    zkeyFinalPath,
    `phase2-${circuit}-local`,
    randomBytes(32).toString('hex'),
  );

  const vkey = await snarkjs.zKey.exportVerificationKey(zkeyFinalPath);
  fs.writeFileSync(vkeyPath, JSON.stringify(vkey, null, 2));

  const templatePath = path.join(
    BLOCKCHAIN_DIR,
    'node_modules',
    'snarkjs',
    'templates',
    'verifier_groth16.sol.ejs',
  );
  const verifierSol = await snarkjs.zKey.exportSolidityVerifier(zkeyFinalPath, {
    groth16: fs.readFileSync(templatePath, 'utf8'),
  });
  fs.writeFileSync(verifierSolPath, verifierSol);

  return { info, power, paths: { zkeyPath: zkeyFinalPath, vkeyPath, verifierSolPath } };
}
