/**
 * scripts/tools/transferSmoke.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Drives a full transfer through the D28/D46 API, playing both parties — and,
 * for the final publish, the officer's wallet too.
 *
 * A transfer cannot be exercised with curl alone: step 3 needs a real Groth16
 * proof over a witness that includes BOTH owners' secrets (§2.4), and the new
 * Merkle path only the registry can compute. This script is that missing piece
 * — the seller's bundle in, a published root out.
 *
 * It walks:
 *   1. the officer names the plot          (propertyId)
 *   1b. the officer freezes the seller      → RootRegistry.freezeOwners (D80)
 *   2. the registry projects the new tree and issues the buyer's secret (D77)
 *                                          → POST /transfers/preview
 *   3. both parties prove, in one session  → POST /transfers (buyer secret included)
 *   4. an officer approves the proof       → POST /transfers/:id/approve
 *   5. the officer batches + publishes     → POST /government/changesets,
 *      sign the returned root, POST .../confirm (D44/D46)
 * then points at the change set's archive, which carries the buyer's bundle
 * (D77), and re-submits the spent proof to confirm it is rejected.
 *
 * D47 — every /transfers route is officer-only now, not just approve, so every
 * call below sends GOV_API_KEY, including preview and the final replay.
 *
 * D43/D46 — publishing a root is signed in the officer's browser wallet; the
 * backend cannot do it anymore. This script has no browser, so step 5 stands
 * in for Metamask by calling RootRegistry directly with the deployer/authority
 * private key (AUTHORITY_PRIVATE_KEY, falling back to PRIVATE_KEY — the same
 * pair ChainService reads). The real government portal delegates that click to
 * Metamask; signing here is a stand-in for scripted demos/CI, never the
 * intended signer.
 *
 * Usage:
 *   GOV_API_KEY=... pnpm --filter blockchain run transfer:smoke <unzipped-bundle-dir>
 *
 * The directory is a claimed bundle: it must contain receipt.json AND
 * secret.json — the secret never leaves the owner, so only they can do this.
 *
 * SAVE_PROOF_DIR=<dir> also writes the transfer proof to
 * <dir>/transfer.verify.json, in the shape proof:bodies writes. That file is
 * how the Phase-9 `/resident/verify` runbook gets a transfer proof to check;
 * nothing in the resident portal can generate one (see the note at the call).
 */

import * as fs from 'fs';
import * as path from 'path';

import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

import { buildTransferInput } from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import { loadDeployment, resolveRpcUrl } from '../../shared/deployments';
import { OwnerSecretFile, Receipt, receiptToLURRecord } from '../../shared/receipt';
import { LURRecord } from '../../shared/types';
import { generateGroth16Proof, getCircuitPaths } from '../../shared/zkpHelper';
import { RootRegistry__factory } from '../../typechain-types';
import { abort, postJson } from '../lib/http';
import { BLOCKCHAIN_DIR } from '../lib/paths';

// This script runs under plain ts-node, not `hardhat run` — .env is not loaded
// automatically the way hardhat.config.ts loads it for the rest of the stack.
// Needed from here on for the private key that signs the change-set root.
dotenv.config({ path: path.resolve(BLOCKCHAIN_DIR, '../.env') });

/** What POST /transfers/preview returns (D28 step 2), buyer secret included (D77). */
interface TransferPreview {
  newOwnerSecret: string;
  newOwnerCommitment: string;
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

/** What POST /transfers/:id/approve returns — a decision only (D46). Publishing the root is a separate, later step. */
interface TransferApproval {
  id: number;
  propertyId: string;
  status: string;
  decidedAt: string | null;
}

/** What POST /government/changesets returns (D44/D46 phase 1). */
interface ChangeSetDraft {
  id: number;
  newRoot: string;
  transferIds: number[];
  revocationIds: number[];
  revocationCalldata: { propertyIds: string[]; reasonCodes: number[]; detailHashes: string[] };
}

/** What POST /government/changesets/:id/confirm returns (D44/D46 phase 2). */
interface ChangeSetConfirmation {
  id: number;
  rootVersion: number;
  txHash: string | null;
}

async function main(): Promise<void> {
  const bundleDir = process.argv[2];
  if (!bundleDir) {
    throw new Error('Usage: transfer:smoke <unzipped-bundle-dir>');
  }

  const apiKey = process.env.GOV_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GOV_API_KEY must be set — every /transfers route is officer-only now (D47), and so is ' +
        'POST /government/changesets',
    );
  }

  const receipt: Receipt = JSON.parse(
    fs.readFileSync(path.join(bundleDir, 'receipt.json'), 'utf8'),
  );
  const secret: OwnerSecretFile = JSON.parse(
    fs.readFileSync(path.join(bundleDir, 'secret.json'), 'utf8'),
  );
  const propertyId = receipt.propertyId;

  console.log(`\nproperty ${propertyId}`);
  console.log(`  seller commitment  ${receipt.record.ownerCommitment.slice(0, 24)}…`);

  // ── Step 1b: freeze the seller BEFORE anything is recorded (D80) — the
  // backend refuses the submit otherwise (409 OwnerNotFrozen).
  const freezeTx = await freezeSeller(propertyId, receipt.record.ownerCommitment);
  console.log(freezeTx ? `freeze    seller frozen, tx ${freezeTx}` : 'freeze    seller already frozen');

  // ── Step 2: the registry projects the tree and issues the buyer's secret,
  // like an issuance round's (D77). It is stored only when the proof is
  // submitted, and reaches the buyer in the change set's archive.
  const preview = await postJson<TransferPreview>('/transfers/preview', { propertyId }, apiKey);
  if (preview.status >= 400) abort('preview', preview);
  const newOwnerSecret = BigInt(preview.body.newOwnerSecret);
  const newOwnerCommitment = BigInt(preview.body.newOwnerCommitment);
  console.log(`  buyer  commitment  ${newOwnerCommitment.toString().slice(0, 24)}… (issued, D77)`);
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

  // The only way to obtain a transfer proof.json for the Phase-9 verifier
  // runbook. No resident screen can produce one: a transfer witness needs BOTH
  // parties' secrets and the guarded preview (D47/D51), so /resident/proof
  // deliberately offers ownership and mortgage only. Same file shape as
  // proof:bodies writes, so `/resident/verify` reads it with no special case.
  if (process.env.SAVE_PROOF_DIR) {
    const outDir = process.env.SAVE_PROOF_DIR;
    const filePath = path.join(outDir, 'transfer.verify.json');
    const body = {
      circuitType: 'transfer',
      proof: proof.proof,
      publicSignals: proof.publicSignals,
      onChain: false,
    };
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(body, null, 2), 'utf8');
    // ⚠️ Expires with the proof: currentTimestamp is baked in and the registry
    // rejects anything more than 600s off (D26).
    console.log(`saved     ${filePath} — paste within ~10 minutes (D26)`);
  }

  const submission = {
    propertyId,
    newOwnerCommitment: newOwnerCommitment.toString(),
    newOwnerSecret: newOwnerSecret.toString(),
    proof: proof.proof,
    publicSignals: proof.publicSignals,
  };

  // D47 — submit is officer-only now too, not just approve.
  const submit = await postJson<TransferRequest>('/transfers', submission, apiKey);
  if (submit.status >= 400) abort('submit', submit);
  console.log(`submit    queued as request #${submit.body.id} (status ${submit.body.status})`);

  // ── Step 4: the human decision — records APPROVED only, publishes nothing ─
  // (D46: publishing moves to the batched change set below.)
  const approve = await postJson<TransferApproval>(
    `/transfers/${submit.body.id}/approve`,
    {},
    apiKey,
  );
  if (approve.status >= 400) abort('approve', approve);
  console.log(`approve   status ${approve.body.status} — queued for the next change set (D46)`);

  // ── Step 5: batch + publish. The backend can no longer sign this itself
  // (D43) — an officer's wallet does, in the browser. This script has no
  // browser, so it plays that role directly against RootRegistry with the
  // deployer/authority key; see publishChangeSetRoot() below.
  const draft = await postJson<ChangeSetDraft>('/government/changesets', {}, apiKey);
  if (draft.status >= 400) abort('changeset draft', draft);
  console.log(
    `changeset #${draft.body.id}: ${draft.body.transferIds.length} transfer(s), ` +
      `${draft.body.revocationIds.length} revocation(s), projected root ` +
      `${draft.body.newRoot.slice(0, 20)}…`,
  );

  const txHash = await publishChangeSetRoot(draft.body);
  console.log(`publish   tx ${txHash} (signed directly here — stands in for Metamask, D43)`);

  const confirm = await postJson<ChangeSetConfirmation>(
    `/government/changesets/${draft.body.id}/confirm`,
    { txHash },
    apiKey,
  );
  if (confirm.status >= 400) abort('changeset confirm', confirm);
  console.log(`confirm   root version ${confirm.body.rootVersion}`);
  console.log(
    `archive   GET /api/government/changesets/${draft.body.id}/archive — the buyer's bundle, ` +
      `secret.json included (D77)`,
  );

  // ── The proof is now spent: its oldRoot has stopped being latest ───────────
  const replay = await postJson<{ message?: string }>('/transfers', submission, apiKey);
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

/**
 * RootRegistry connected with the authority key, after checking its role.
 * This script has no browser, so it plays the officer's wallet (D43) — for
 * the freeze at the counter (D80) and for the change-set root at the end.
 */
async function authorityRegistry() {
  const network = process.env.CHAIN_NETWORK ?? 'localhost';
  const privateKey = process.env.AUTHORITY_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      'AUTHORITY_PRIVATE_KEY (or PRIVATE_KEY) must be set to sign for the registry — see ' +
        '.env.example (Hardhat account #0 for local dev). This stands in for the officer’s ' +
        'Metamask signature (D43).',
    );
  }

  const deployment = loadDeployment(BLOCKCHAIN_DIR, network);
  const provider = new ethers.JsonRpcProvider(resolveRpcUrl(network));
  const signer = new ethers.Wallet(privateKey, provider);
  const registry = RootRegistry__factory.connect(deployment.contracts.RootRegistry, signer);

  // Check the role before sending. Without this the call fails inside ethers as
  // a raw AccessControlUnauthorizedAccount CALL_EXCEPTION, which says nothing
  // about the actual mistake — and the actual mistake is easy to make, because
  // PRIVATE_KEY in .env is usually the Sepolia deployer while the local node's
  // authority is Hardhat account #0. Those are different accounts.
  const role = await registry.STATE_AUTHORITY_ROLE();
  if (!(await registry.hasRole(role, signer.address))) {
    throw new Error(
      `${signer.address} does not hold STATE_AUTHORITY_ROLE on ${network}, so it cannot ` +
        `sign for the registry. The authority for this deployment is ${deployment.authority.address}. ` +
        `Set AUTHORITY_PRIVATE_KEY to that account's key (on a local node it is Hardhat ` +
        `account #0) — PRIVATE_KEY alone is usually the testnet deployer, which is a ` +
        `different account.`,
    );
  }
  return registry;
}

/**
 * Freeze the seller before anything is recorded (D80). Returns the tx hash,
 * or null when the chain already freezes exactly this owner (a re-run).
 */
async function freezeSeller(propertyId: string, ownerCommitment: string): Promise<string | null> {
  const registry = await authorityRegistry();
  if ((await registry.frozenOwner(BigInt(propertyId))) === BigInt(ownerCommitment)) return null;

  const tx = await registry.freezeOwners([BigInt(propertyId)], [BigInt(ownerCommitment)]);
  const receipt = await tx.wait();
  return receipt!.hash;
}

/**
 * Sign and publish the change set's projected root directly against
 * RootRegistry — the step a browser wallet performs in the real government
 * portal (D43/D46).
 */
async function publishChangeSetRoot(draft: ChangeSetDraft): Promise<string> {
  const registry = await authorityRegistry();

  const newRoot = ethers.toBeHex(BigInt(draft.newRoot), 32);
  const { propertyIds, reasonCodes, detailHashes } = draft.revocationCalldata;

  // publishRoot() and publishRootWithRevocations() both live on RootRegistry
  // (D45) — only the second also writes the on-chain revocations mapping, so
  // it is used only when this round actually contains any.
  const tx =
    draft.revocationIds.length > 0
      ? await registry.publishRootWithRevocations(
          newRoot,
          propertyIds.map((id) => BigInt(id)),
          reasonCodes,
          detailHashes,
        )
      : await registry.publishRoot(newRoot);

  const receipt = await tx.wait();
  return receipt!.hash;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
