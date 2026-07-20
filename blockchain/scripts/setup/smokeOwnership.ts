/**
 * scripts/setup/smokeOwnership.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * End-to-end toolchain smoke test for ONE circuit (ownership).
 *
 * Run: pnpm --filter blockchain run circuits:smoke
 *      (run `circuits:compile` first — this consumes its output)
 *
 * Why this exists in Phase 2 rather than Phase 3: THESIS_IMPLEMENTATION_GUIDE
 * risk #6 is "circomlib/Poseidon version mismatch, discovered late". Proving
 * circom -> r1cs -> zkey -> proof -> verify works for one circuit now means
 * Phase 3 is a matter of repetition, not of debugging the toolchain. It is
 * deliberately NOT the real ceremony: one local contribution, throwaway
 * entropy. Phase 3 does all three circuits properly and records the metrics.
 *
 * Trusted setup Phase 1 reuses the public Hermez/iden3 Powers of Tau (D13) —
 * we only run the circuit-specific Phase 2 contribution locally.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as snarkjs from 'snarkjs';

import { buildTree, generateMerkleProof } from '../../shared/merkleTree';
import { buildOwnershipInput, PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import { generateMockRecords } from '../generateMockData';

const CIRCUIT = 'ownership';
const BLOCKCHAIN_DIR = path.resolve(__dirname, '../..');
const BUILD_DIR = path.join(BLOCKCHAIN_DIR, 'circuits', 'build', CIRCUIT);
const PTAU_DIR = path.join(BLOCKCHAIN_DIR, 'ptau');
const PTAU_BASE_URL = 'https://storage.googleapis.com/zkevm/ptau';

const R1CS_PATH = path.join(BUILD_DIR, `${CIRCUIT}.r1cs`);
const WASM_PATH = path.join(BUILD_DIR, `${CIRCUIT}_js`, `${CIRCUIT}.wasm`);
const ZKEY_INIT_PATH = path.join(BUILD_DIR, `${CIRCUIT}_0000.zkey`);
const ZKEY_FINAL_PATH = path.join(BUILD_DIR, `${CIRCUIT}.zkey`);
const VKEY_PATH = path.join(BUILD_DIR, 'verification_key.json');
const VERIFIER_SOL_PATH = path.join(BUILD_DIR, 'Groth16VerifierOwnership.sol');

function step(message: string): void {
  console.log(`\n▶ ${message}`);
}

/** Smallest Powers-of-Tau exponent whose domain covers this circuit. */
function ptauPowerFor(info: snarkjs.R1csInfo): number {
  const needed = info.nConstraints + info.nPubInputs + info.nOutputs;
  let power = 8;
  while (2 ** power < needed) power++;
  return power;
}

/**
 * Fetch the public ptau if it isn't cached. blockchain/ptau/*.ptau is
 * gitignored — this is a large, reproducible public artifact, not source.
 */
async function ensurePtau(power: number): Promise<string> {
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
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(partial));
  fs.renameSync(partial, destination);

  return destination;
}

async function main(): Promise<void> {
  if (!fs.existsSync(R1CS_PATH) || !fs.existsSync(WASM_PATH)) {
    throw new Error(
      `Missing build output for ${CIRCUIT}. Run "pnpm --filter blockchain run circuits:compile" first.`,
    );
  }

  step('Reading circuit R1CS');
  const info = await snarkjs.r1cs.info(R1CS_PATH);
  const power = ptauPowerFor(info);
  console.log(
    `  constraints: ${info.nConstraints}  public: ${info.nPubInputs}  private: ${info.nPrvInputs}`,
  );
  console.log(`  smallest sufficient Powers of Tau: 2^${power}`);

  step('Ensuring Powers of Tau (public Hermez/iden3 ceremony — D13)');
  const ptauPath = await ensurePtau(power);

  step('Groth16 setup (circuit-specific Phase 2)');
  await snarkjs.zKey.newZKey(R1CS_PATH, ptauPath, ZKEY_INIT_PATH);
  console.log(`  initial zkey -> ${path.basename(ZKEY_INIT_PATH)}`);

  // One local contribution with throwaway entropy. A real ceremony needs
  // multiple independent contributors; called out as a limitation in the thesis.
  await snarkjs.zKey.contribute(
    ZKEY_INIT_PATH,
    ZKEY_FINAL_PATH,
    'phase2-smoke-local',
    randomBytes(32).toString('hex'),
  );
  console.log(`  contributed  -> ${path.basename(ZKEY_FINAL_PATH)}`);

  step('Exporting verification key and Solidity verifier');
  const vkey = await snarkjs.zKey.exportVerificationKey(ZKEY_FINAL_PATH);
  fs.writeFileSync(VKEY_PATH, JSON.stringify(vkey, null, 2));

  const templatePath = path.join(
    BLOCKCHAIN_DIR,
    'node_modules',
    'snarkjs',
    'templates',
    'verifier_groth16.sol.ejs',
  );
  const verifierSol = await snarkjs.zKey.exportSolidityVerifier(ZKEY_FINAL_PATH, {
    groth16: fs.readFileSync(templatePath, 'utf8'),
  });
  fs.writeFileSync(VERIFIER_SOL_PATH, verifierSol);
  console.log(`  ${path.basename(VKEY_PATH)}, ${path.basename(VERIFIER_SOL_PATH)}`);
  console.log('  (Phase 4 moves the verifier into contracts/verifiers/ to be compiled)');

  step('Generating a proof from real mock data');
  const now = nowUnixTimestamp();
  const { records, secrets } = await generateMockRecords(10);
  const record = records[0];
  const ownerSecret = secrets.get(record.propertyId);
  if (ownerSecret === undefined) {
    throw new Error(`No ownerSecret generated for propertyId ${record.propertyId}`);
  }

  const tree = await buildTree(records);
  const proofData = await generateMerkleProof(tree, record);
  const input = buildOwnershipInput({ record, ownerSecret, proof: proofData, currentTimestamp: now });

  const startedAt = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_FINAL_PATH);
  const proveMs = Date.now() - startedAt;

  step('Verifying');
  const verifyStartedAt = Date.now();
  const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  const verifyMs = Date.now() - verifyStartedAt;

  if (!verified) {
    throw new Error('groth16.verify returned false — the pipeline is broken');
  }

  // The public signals must line up with what the circuit tests asserted and
  // what LandRegistryVerifier.sol will index in Phase 4 (D21).
  const expected = [tree.root, record.propertyId, record.ownerCommitment, now].map(String);
  PUBLIC_SIGNAL_ORDER.ownership.forEach((name, i) => {
    if (publicSignals[i] !== expected[i]) {
      throw new Error(
        `publicSignals[${i}] should be ${name}=${expected[i]} but was ${publicSignals[i]}`,
      );
    }
  });

  const proofBytes = Buffer.byteLength(JSON.stringify(proof), 'utf8');
  console.log('\n─────────────────────────────────────────────');
  console.log(`  circuit            ${CIRCUIT}`);
  console.log(`  constraints        ${info.nConstraints}`);
  console.log(`  proof time         ${proveMs} ms`);
  console.log(`  verify time        ${verifyMs} ms`);
  console.log(`  proof size         ${proofBytes} bytes`);
  console.log(`  public signals     ${publicSignals.length} (${PUBLIC_SIGNAL_ORDER.ownership.join(', ')})`);
  console.log(`  verified           ${verified}`);
  console.log('─────────────────────────────────────────────');
  console.log('\nPipeline circom -> snarkjs -> verify is working end to end.');
  console.log('These are smoke numbers (Node, one circuit); Phase 3 records the real table.\n');
}

main()
  .then(() => {
    // snarkjs leaves its worker threads running, so the process never exits on
    // its own. Everything above already completed and asserted.
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
