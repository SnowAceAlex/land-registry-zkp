/**
 * scripts/tools/proofBodies.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Writes ready-to-paste request bodies for `POST /api/proof/verify`.
 *
 * Swagger UI can drive every other endpoint by hand, but not this one: a
 * Groth16 proof cannot be typed. It has to be generated from a witness holding
 * the owner's secret and the full record, which is exactly what never leaves
 * the owner's machine. So the split is: generate here, paste there.
 *
 * `owner:smoke` already proves and verifies in one go — this exists for the
 * demo where the verification itself has to happen in front of someone, in the
 * browser, on the endpoint's own page.
 *
 * ⚠️ The bodies expire. `currentTimestamp` is baked into the proof and the
 * registry rejects anything more than 600s off (D26), and the stapled status
 * attestation (D82) lasts 600s too — paste within ~10 minutes or re-run.
 *
 * While the plot has an open procedure the registry refuses the attestation
 * (409); the bodies are then written WITHOUT one, which is exactly what the
 * manual runbook pastes to watch them fail with InvalidAttestation.
 *
 * Usage:
 *   pnpm --filter blockchain run proof:bodies <unzipped-bundle-dir> [out-dir]
 *
 * No GOV_API_KEY — the proof endpoints are unguarded on purpose (D39).
 */

import * as fs from 'fs';
import * as path from 'path';

import { CircuitType, buildMortgageInput, buildOwnershipInput } from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import { OwnerSecretFile, Receipt, receiptToLURRecord } from '../../shared/receipt';
import { LURRecord, MerkleProofData, ProofInput } from '../../shared/types';
import { generateGroth16Proof, getCircuitPaths } from '../../shared/zkpHelper';
import { abort, getJson } from '../lib/http';
import { BLOCKCHAIN_DIR } from '../lib/paths';

/** Subset of what GET /api/proof/:propertyId returns. */
interface RefreshedProof {
  leaf: string;
  merkleRoot: string;
  rootVersion: number | null;
  siblings: string[];
  pathIndices: number[];
  onChain: { root: string; version: number };
  source: 'cache' | 'rebuilt';
}

type Staple = { expiresAt: string; signature: string };

/** Seconds of remaining term the owner chooses to prove they still have (D16). */
const MORTGAGE_THRESHOLD = BigInt(process.env.MIN_REMAINING_TERM ?? String(5 * 365 * 24 * 60 * 60));

async function main(): Promise<void> {
  const bundleDir = process.argv[2];
  if (!bundleDir) {
    throw new Error('Usage: proof:bodies <unzipped-bundle-dir> [out-dir]');
  }
  const outDir = process.argv[3] ?? bundleDir;

  const receipt: Receipt = readJson(bundleDir, 'receipt.json');
  const secret: OwnerSecretFile = readJson(bundleDir, 'secret.json');
  const propertyId = receipt.propertyId;

  console.log(`\nbundle:    ${bundleDir}`);
  console.log(`property:  ${propertyId}`);

  // Refreshing first is not optional: any published root invalidates the
  // Merkle proof sitting in the receipt, including roots from other people's
  // transfers (§3.1).
  const response = await getJson<RefreshedProof>(`/proof/${propertyId}`);
  if (response.status >= 400) abort('refresh proof', response);
  const refreshed = response.body;

  console.log(
    `refresh    source=${refreshed.source}, root version ${refreshed.rootVersion}` +
      (refreshed.merkleRoot === receipt.merkleRoot ? '' : ` (receipt was v${receipt.rootVersion})`),
  );

  const record: LURRecord = receiptToLURRecord(receipt.record);
  const proof: MerkleProofData = {
    leaf: BigInt(refreshed.leaf),
    siblings: refreshed.siblings.map((sibling) => BigInt(sibling)),
    pathIndices: refreshed.pathIndices,
    root: BigInt(refreshed.merkleRoot),
  };
  const ownerSecret = BigInt(secret.ownerSecret);
  const currentTimestamp = nowUnixTimestamp();

  const attested = await getJson<Staple & { reason?: string }>(`/proof/${propertyId}/attestation`);
  let staple: Staple | undefined;
  if (attested.status === 409) {
    console.log('attestation REFUSED — the plot has an open procedure; bodies carry none (D82)');
  } else if (attested.status >= 400) {
    abort('fetch status attestation', attested);
  } else {
    staple = { expiresAt: attested.body.expiresAt, signature: attested.body.signature };
    console.log(`attestation expires at ${staple.expiresAt}`);
  }

  const written: string[] = [];
  written.push(
    await writeBody(
      'ownership',
      buildOwnershipInput({ record, ownerSecret, proof, currentTimestamp }),
      staple,
      outDir,
    ),
  );
  written.push(
    await writeBody(
      'mortgage',
      buildMortgageInput({
        record,
        ownerSecret,
        proof,
        currentTimestamp,
        minRequiredRemainingTerm: MORTGAGE_THRESHOLD,
      }),
      staple,
      outDir,
    ),
  );

  console.log('\nPaste either file into POST /api/proof/verify → Try it out → Request body.');
  console.log('Set "onChain": true in the body to also ask LandRegistryVerifier.');
  console.log(`⚠️  Valid for ~10 minutes (D26 freshness) — re-run this after that.\n`);
  for (const file of written) console.log(`  ${file}`);
}

// ─────────────────────────────────────────────────────────────────────────────

function readJson<T>(dir: string, file: string): T {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath} — point this at an unzipped bundle directory`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

/** Prove one circuit and write the verify request body. Returns the file path. */
async function writeBody(
  circuitType: CircuitType,
  input: ProofInput,
  attestation: Staple | undefined,
  outDir: string,
): Promise<string> {
  const { wasmPath, zkeyPath } = getCircuitPaths(circuitType, BLOCKCHAIN_DIR);
  if (!fs.existsSync(zkeyPath)) {
    throw new Error(
      `Missing ${zkeyPath} — run \`pnpm --filter blockchain run circuits:setup\` first`,
    );
  }

  const startedAt = Date.now();
  const { proof, publicSignals } = await generateGroth16Proof(
    input,
    wasmPath,
    zkeyPath,
    circuitType,
  );
  console.log(`${circuitType.padEnd(10)} proof generated in ${Date.now() - startedAt} ms`);

  // circuitType is written out even though the endpoint infers it from the
  // signal count — the file is meant to be read by a person before it is
  // pasted, and "which circuit is this" is the first thing they ask.
  const body = { circuitType, proof, publicSignals, attestation, onChain: false };
  const filePath = path.join(outDir, `${circuitType}.verify.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(body, null, 2), 'utf8');
  return filePath;
}

main()
  .then(() => process.exit(0)) // snarkjs leaves worker threads running
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
