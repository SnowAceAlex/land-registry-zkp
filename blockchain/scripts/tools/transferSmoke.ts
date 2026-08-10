/**
 * scripts/tools/transferSmoke.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Drives a full transfer through the Phase 5 API, playing both parties.
 *
 * A transfer cannot be exercised with curl alone: step 3 needs a real Groth16
 * proof over a witness that includes BOTH owners' secrets (§2.4), and the new
 * Merkle path only the registry can compute. This script is that missing piece
 * — the seller's bundle in, an approved transfer out.
 *
 * It walks the four steps of D28:
 *   1. both parties state intent           (propertyId + newOwnerCommitment)
 *   2. the registry projects the new tree  → POST /transfers/preview
 *   3. both parties prove, in one session  → POST /transfers
 *   4. an officer approves and publishes   → POST /transfers/:id/approve
 * then re-submits the spent proof to confirm it is rejected.
 *
 * Usage:
 *   GOV_API_KEY=... pnpm --filter blockchain run transfer:smoke <unzipped-bundle-dir>
 *
 * The directory is a claimed bundle: it must contain receipt.json AND
 * secret.json — the secret never leaves the owner, so only they can do this.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { buildTransferInput } from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import { poseidonHash } from '../../shared/merkleTree';
import { OwnerSecretFile, Receipt, receiptToLURRecord } from '../../shared/receipt';
import { LURRecord } from '../../shared/types';
import { generateGroth16Proof, getCircuitPaths } from '../../shared/zkpHelper';
import { abort, postJson } from '../lib/http';
import { BLOCKCHAIN_DIR } from '../lib/paths';

/** What POST /transfers/preview returns (D28 step 2). */
interface TransferPreview {
  oldMerkleRoot: string;
  newMerkleRoot: string;
  oldSiblings: string[];
  oldPathIndices: number[];
  newSiblings: string[];
  newPathIndices: number[];
}

interface TransferRequest {
  id: number;
  status: string;
}

interface TransferApproval {
  version: number;
  txHash: string;
}

async function main(): Promise<void> {
  const bundleDir = process.argv[2];
  if (!bundleDir) {
    throw new Error('Usage: transfer:smoke <unzipped-bundle-dir>');
  }

  const apiKey = process.env.GOV_API_KEY;
  if (!apiKey) {
    throw new Error('GOV_API_KEY must be set — step 4 is the officer approval and is guarded');
  }

  const receipt: Receipt = JSON.parse(
    fs.readFileSync(path.join(bundleDir, 'receipt.json'), 'utf8'),
  );
  const secret: OwnerSecretFile = JSON.parse(
    fs.readFileSync(path.join(bundleDir, 'secret.json'), 'utf8'),
  );
  const propertyId = receipt.propertyId;

  // The buyer picks their own secret and shares only the commitment — the
  // registry never learns it, which is the whole point of the commitment.
  const newOwnerSecret =
    process.env.NEW_OWNER_SECRET !== undefined
      ? BigInt(process.env.NEW_OWNER_SECRET)
      : BigInt('0x' + randomBytes(31).toString('hex'));
  const newOwnerCommitment = await poseidonHash([newOwnerSecret]);

  console.log(`\nproperty ${propertyId}`);
  console.log(`  seller commitment  ${receipt.record.ownerCommitment.slice(0, 24)}…`);
  console.log(`  buyer  commitment  ${newOwnerCommitment.toString().slice(0, 24)}…`);
  console.log(`\n  ⚠  keep this buyer secret — it is the new owner's only proof of ownership:`);
  console.log(`     ${newOwnerSecret}\n`);

  // ── Step 2: the registry projects the tree ─────────────────────────────────
  const preview = await postJson<TransferPreview>('/transfers/preview', {
    propertyId,
    newOwnerCommitment: newOwnerCommitment.toString(),
  });
  if (preview.status >= 400) abort('preview', preview);
  console.log(`preview   old root ${preview.body.oldMerkleRoot.slice(0, 20)}…`);
  console.log(`          new root ${preview.body.newMerkleRoot.slice(0, 20)}…`);

  // ── Step 3: both parties generate one proof together ───────────────────────
  // Rebuilt from the receipt's own fields — if any were edited, the offchainHash
  // changes and the leaf no longer matches the tree.
  const oldRecord: LURRecord = receiptToLURRecord(receipt.record);

  const input = buildTransferInput({
    oldRecord,
    // Only the owner changes — the circuit derives both leaves from one set of
    // record signals, so anything else is unprovable by construction (§2.4).
    newRecord: { ...oldRecord, ownerCommitment: newOwnerCommitment },
    oldOwnerSecret: BigInt(secret.ownerSecret),
    newOwnerSecret,
    oldProof: {
      leaf: BigInt(receipt.leaf),
      // The preview's paths are used rather than the receipt's: the receipt may
      // predate other transfers, and a stale path proves nothing.
      siblings: preview.body.oldSiblings.map((s: string) => BigInt(s)),
      pathIndices: preview.body.oldPathIndices,
      root: BigInt(preview.body.oldMerkleRoot),
    },
    newProof: {
      leaf: 0n, // the builder reads only siblings/pathIndices/root
      siblings: preview.body.newSiblings.map((s: string) => BigInt(s)),
      pathIndices: preview.body.newPathIndices,
      root: BigInt(preview.body.newMerkleRoot),
    },
    currentTimestamp: nowUnixTimestamp(),
    minRequiredRemainingTerm: BigInt(process.env.MIN_REMAINING_TERM ?? '0'),
  });

  const { wasmPath, zkeyPath } = getCircuitPaths('transfer', BLOCKCHAIN_DIR);
  if (!fs.existsSync(zkeyPath)) {
    throw new Error(
      `Missing ${zkeyPath} — run \`pnpm --filter blockchain run circuits:setup\` first`,
    );
  }

  const startedAt = Date.now();
  const proof = await generateGroth16Proof(input, wasmPath, zkeyPath, 'transfer');
  console.log(`proof     generated in ${Date.now() - startedAt} ms`);

  const submission = {
    propertyId,
    newOwnerCommitment: newOwnerCommitment.toString(),
    proof: proof.proof,
    publicSignals: proof.publicSignals,
  };

  const submit = await postJson<TransferRequest>('/transfers', submission);
  if (submit.status >= 400) abort('submit', submit);
  console.log(`submit    queued as request #${submit.body.id} (status ${submit.body.status})`);

  // ── Step 4: the human decision ─────────────────────────────────────────────
  const approve = await postJson<TransferApproval>(
    `/transfers/${submit.body.id}/approve`,
    {},
    apiKey,
  );
  if (approve.status >= 400) abort('approve', approve);
  console.log(`approve   root version ${approve.body.version}, tx ${approve.body.txHash}`);

  // ── The proof is now spent: its oldRoot has stopped being latest ───────────
  const replay = await postJson<{ message?: string }>('/transfers', submission);
  const replayRejected = replay.status === 422;
  console.log(
    `replay    HTTP ${replay.status} — ${replayRejected ? 'correctly rejected' : 'UNEXPECTEDLY ACCEPTED'}` +
      `: ${replay.body?.message ?? ''}`,
  );

  console.log(
    replayRejected
      ? '\nTransfer flow complete.\n'
      : '\nTransfer completed but the spent proof was replayable — investigate.\n',
  );
  process.exit(replayRejected ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
