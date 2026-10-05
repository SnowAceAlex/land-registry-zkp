/**
 * scripts/tools/ownerSmoke.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Plays a land owner against the Phase 6 API: refresh the Merkle proof, fetch
 * the status attestation (D82), prove ownership and clean title, have the
 * registry verify both.
 *
 * This is the Node twin of what the Phase 8 owner dashboard will do in the
 * browser, written first on purpose — it proves the whole owner path end to end
 * before any UI exists, and the proof timings it prints are the browser-free
 * baseline for Chapter 5.
 *
 * The step that matters most is the first one. A bundle's Merkle proof is
 * invalidated by ANY published root, not just one touching this property (§3.1),
 * so an owner who proves straight from their receipt will eventually be told
 * their proof is invalid for reasons that are nobody's fault. Refreshing before
 * proving is the fix, and the reason `GET /api/proof/:propertyId` exists.
 *
 * Usage:
 *   pnpm --filter blockchain run owner:smoke <unzipped-bundle-dir>
 *
 * No GOV_API_KEY: the proof endpoints are deliberately unguarded (D39) — the
 * caller here is a land owner, not an officer. The directory must contain both
 * receipt.json and secret.json, so only the owner can run this.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CircuitType, buildMortgageInput, buildOwnershipInput } from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import { OwnerSecretFile, Receipt, receiptToLURRecord } from '../../shared/receipt';
import { LURRecord, MerkleProofData, ProofInput } from '../../shared/types';
import { generateGroth16Proof, getCircuitPaths } from '../../shared/zkpHelper';
import { getJson, postJson } from '../lib/http';
import { BLOCKCHAIN_DIR } from '../lib/paths';
import { CheckReport } from '../lib/report';

/** What GET /api/proof/:propertyId returns. */
interface RefreshedProof {
  propertyId: string;
  leaf: string;
  merkleRoot: string;
  rootVersion: number | null;
  siblings: string[];
  pathIndices: number[];
  onChain: { root: string; version: number };
  inSync: boolean;
  source: 'cache' | 'rebuilt';
}

interface VerifyResult {
  valid: boolean;
  circuitType: string;
  checks: { onChain: boolean | null };
  disclosed: Record<string, string>;
  /** Present on a 422 instead of the fields above. */
  reason?: string;
  message?: string;
}

/** What GET /api/proof/:propertyId/attestation returns (D82). */
interface AttestationResponse {
  expiresAt: string;
  signature: string;
  attester: string;
  /** Present on a 409 instead. */
  reason?: string;
}

type Staple = { expiresAt: string; signature: string };

/** Seconds of remaining term the owner chooses to prove they still have (D16). */
const MORTGAGE_THRESHOLD = BigInt(process.env.MIN_REMAINING_TERM ?? String(5 * 365 * 24 * 60 * 60));

async function main(): Promise<void> {
  const bundleDir = process.argv[2];
  if (!bundleDir) {
    throw new Error('Usage: owner:smoke <unzipped-bundle-dir>');
  }

  const receipt: Receipt = readJson(bundleDir, 'receipt.json');
  const secret: OwnerSecretFile = readJson(bundleDir, 'secret.json');
  const propertyId = receipt.propertyId;
  const report = new CheckReport();

  console.log(`\nbundle:    ${bundleDir}`);
  console.log(`property:  ${propertyId}\n`);

  // ── 1. Refresh the Merkle proof ────────────────────────────────────────────
  const refreshed = await getOrAbort<RefreshedProof>(`/proof/${propertyId}`, 'refresh proof');

  console.log(`refresh   source=${refreshed.source}, root version ${refreshed.rootVersion}`);
  report.check(
    refreshed.inSync,
    'registry tree matches the published root',
    `version ${refreshed.onChain.version}`,
    'the database and chain have drifted apart — either the chain was restarted/redeployed ' +
      'while the database kept its rows (see PHASE_5_MANUAL_TEST.md §0b), or an issuance/' +
      'change-set draft was signed but never confirmed. There is no longer a single call that ' +
      'republishes to repair this (D43) — resolve the draft, or redeploy and re-issue.',
  );

  const rootChanged = refreshed.merkleRoot !== receipt.merkleRoot;
  if (rootChanged) {
    report.note(
      'the bundle Merkle proof is STALE',
      `receipt v${receipt.rootVersion} → current v${refreshed.rootVersion}. ` +
        'Expected after anyone transfers; this refresh is exactly the repair.',
    );
  } else {
    report.pass('bundle Merkle proof is still current', `v${receipt.rootVersion}`);
  }

  // The leaf must not move just because the tree did — the record is unchanged,
  // and a differing leaf here would mean the registry altered it.
  report.check(
    refreshed.leaf === receipt.leaf,
    'leaf is unchanged by the refresh',
    refreshed.leaf.slice(0, 20) + '…',
    `receipt says ${receipt.leaf}, registry says ${refreshed.leaf}`,
  );

  // Rebuilt from the receipt's own fields: an edited area or address changes
  // offchainHash (D36), and the leaf then stops matching the tree.
  const record: LURRecord = receiptToLURRecord(receipt.record);
  const proofData: MerkleProofData = {
    leaf: BigInt(refreshed.leaf),
    siblings: refreshed.siblings.map((sibling) => BigInt(sibling)),
    pathIndices: refreshed.pathIndices,
    root: BigInt(refreshed.merkleRoot),
  };
  const ownerSecret = BigInt(secret.ownerSecret);

  // ── 1b. Status attestation: the registry vouches no procedure is open (D82)
  const attestation = await getOrAbort<AttestationResponse>(
    `/proof/${propertyId}/attestation`,
    'fetch status attestation',
  );
  const staple: Staple = { expiresAt: attestation.expiresAt, signature: attestation.signature };
  report.pass('registry signed a status attestation', `by ${attestation.attester}`);

  // ── 2. Ownership — "I hold this property and it is not expired" ────────────
  const ownership = await proveAndVerify(
    'ownership',
    buildOwnershipInput({ record, ownerSecret, proof: proofData, currentTimestamp: now() }),
    staple,
    report,
  );

  // ── 3. Mortgage — "clean title, at least N seconds of term left" (D6/D16) ──
  const mortgage = await proveAndVerify(
    'mortgage',
    buildMortgageInput({
      record,
      ownerSecret,
      proof: proofData,
      currentTimestamp: now(),
      minRequiredRemainingTerm: MORTGAGE_THRESHOLD,
    }),
    staple,
    report,
  );

  // What the bank actually learns — the threshold, never the expiry date.
  if (mortgage) {
    report.check(
      !('validityPeriod' in mortgage.disclosed) && !('encumbranceStatus' in mortgage.disclosed),
      'mortgage proof discloses the threshold only',
      Object.keys(mortgage.disclosed).join(', '),
      `LEAKED: ${Object.keys(mortgage.disclosed).join(', ')}`,
    );
  }

  // ── 4. The contract's own verdict ──────────────────────────────────────────
  if (ownership) {
    const onChain = await postJson<VerifyResult>('/proof/verify', {
      circuitType: 'ownership',
      proof: ownership.proof,
      publicSignals: ownership.publicSignals,
      attestation: staple,
      onChain: true,
    });

    // The off-chain check just passed against wall-clock time, so a
    // StaleTimestamp here means the CHAIN's clock is the odd one out. On a
    // local hardhat node that is the usual case rather than a defect: it only
    // advances block.timestamp when a block is mined, so an idle node drifts
    // behind real time until the next transaction. Say so, or whoever runs this
    // goes looking for a bug in the proof.
    const chainClockDrift = onChain.status === 422 && onChain.body?.reason === 'StaleTimestamp';
    report.check(
      onChain.status === 200 && onChain.body.checks?.onChain === true,
      'LandRegistryVerifier accepts the ownership proof on chain',
      '',
      chainClockDrift
        ? `${onChain.body.message} — the off-chain check passed, so this is almost certainly an ` +
            `IDLE LOCAL NODE whose block.timestamp has fallen behind. Mine a block ` +
            `(curl -X POST -H "Content-Type: application/json" --data ` +
            `'{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":1}' http://127.0.0.1:8545) ` +
            `and re-run.`
        : `HTTP ${onChain.status}: ${onChain.body?.message ?? ''}`,
    );
  }

  // ── 5. The rejection branch: a proof dated an hour ago (D26) ───────────────
  // groth16.verify() returns true for this. Only the freshness check catches it,
  // which is the whole reason D26 exists as a separate rule.
  const stale = await prove(
    'ownership',
    buildOwnershipInput({
      record,
      ownerSecret,
      proof: proofData,
      currentTimestamp: now() - 3600n,
    }),
  );
  const staleResult = await postJson<VerifyResult>('/proof/verify', {
    proof: stale.proof,
    publicSignals: stale.publicSignals,
    attestation: staple,
  });
  report.check(
    staleResult.status === 422 && staleResult.body.reason === 'StaleTimestamp',
    'a proof dated an hour ago is rejected as stale',
    'HTTP 422 StaleTimestamp',
    `HTTP ${staleResult.status} ${staleResult.body?.reason ?? ''} — a replayed proof was ACCEPTED`,
  );

  // ── 6. Without the attestation the same good proof is refused (D82) ────────
  if (ownership) {
    const bare = await postJson<VerifyResult>('/proof/verify', {
      proof: ownership.proof,
      publicSignals: ownership.publicSignals,
    });
    report.check(
      bare.status === 422 && bare.body.reason === 'InvalidAttestation',
      'a proof without its status attestation is rejected',
      'HTTP 422 InvalidAttestation',
      `HTTP ${bare.status} ${bare.body?.reason ?? ''} — an unattested proof was ACCEPTED`,
    );
  }

  // snarkjs leaves worker threads alive; without this the script never exits.
  process.exit(report.summarise());
}

// ─────────────────────────────────────────────────────────────────────────────

function now(): bigint {
  return nowUnixTimestamp();
}

function readJson<T>(dir: string, file: string): T {
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath} — point this at an unzipped bundle directory`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

async function getOrAbort<T>(endpoint: string, step: string): Promise<T> {
  const response = await getJson<T>(endpoint);
  if (response.status >= 400) {
    console.error(`\n${step} failed (HTTP ${response.status}):`);
    console.error(JSON.stringify(response.body, null, 2));
    process.exit(1);
  }
  return response.body;
}

/** Generate a proof, timing it — the number Chapter 5 wants. */
async function prove(
  circuitType: CircuitType,
  input: ProofInput,
): Promise<{ proof: unknown; publicSignals: string[]; ms: number }> {
  const { wasmPath, zkeyPath } = getCircuitPaths(circuitType, BLOCKCHAIN_DIR);
  if (!fs.existsSync(zkeyPath)) {
    throw new Error(
      `Missing ${zkeyPath} — run \`pnpm --filter blockchain run circuits:setup\` first`,
    );
  }

  const startedAt = Date.now();
  const result = await generateGroth16Proof(input, wasmPath, zkeyPath, circuitType);
  return { proof: result.proof, publicSignals: result.publicSignals, ms: Date.now() - startedAt };
}

/**
 * Prove one circuit and have the registry verify it off-chain.
 * Returns undefined on rejection so the caller can skip its follow-up checks —
 * the failure is already recorded in the report.
 */
async function proveAndVerify(
  circuitType: CircuitType,
  input: ProofInput,
  attestation: Staple,
  report: CheckReport,
): Promise<
  { proof: unknown; publicSignals: string[]; disclosed: Record<string, string> } | undefined
> {
  const { proof, publicSignals, ms } = await prove(circuitType, input);
  console.log(`${circuitType.padEnd(9)} proof generated in ${ms} ms`);

  const verified = await postJson<VerifyResult>('/proof/verify', {
    proof,
    publicSignals,
    attestation,
  });
  if (verified.status !== 200 || !verified.body.valid) {
    report.fail(
      `registry verifies the ${circuitType} proof`,
      `HTTP ${verified.status} ${verified.body?.reason ?? ''}: ${verified.body?.message ?? ''}`,
    );
    return undefined;
  }

  report.pass(
    `registry verifies the ${circuitType} proof`,
    `discloses ${Object.keys(verified.body.disclosed).length} signals`,
  );
  return { proof, publicSignals, disclosed: verified.body.disclosed };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
