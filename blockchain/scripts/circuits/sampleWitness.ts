/**
 * scripts/circuits/sampleWitness.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds ONE valid witness per circuit for the end-to-end prove/verify pass in
 * setupAll.ts + smokeOwnership.ts (and reused by test/shared/zkpHelper.test.ts).
 *
 * Everything goes through the D25 builders in shared/circuitInputs.ts — no
 * hand-written witness JSON. The subject record is deterministically valid
 * (FREE, FIXED_TERM, 10 years left) so a prove never randomly lands on a
 * MORTGAGED/expired record; it is buried in random filler so the Merkle path
 * exercises both left- and right-child steps rather than a degenerate path.
 *
 * Self-contained on purpose: scripts must not depend on test/ helpers (that
 * would invert the dependency direction).
 */

import {
  buildMortgageInput,
  buildOwnershipInput,
  buildTransferInput,
} from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import {
  LURMerkleTree,
  buildTree,
  generateMerkleProof,
  poseidonHash,
} from '../../shared/merkleTree';
import {
  EncumbranceStatus,
  LURRecord,
  ProofInput,
  ProofPackage,
  TenureType,
  UseType,
} from '../../shared/types';
import { generateMockRecords } from '../tools/generateMockData';

type CircuitType = ProofPackage['circuitType'];

const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
/** Reserved id for the record under test; generateMockRecords uses 1..N filler. */
const SUBJECT_PROPERTY_ID = 9_001n;
/** Fixed secrets so witnesses are reproducible. */
const SUBJECT_SECRET = 111_222_333_444_555_666_777n;
const BUYER_SECRET = 888_777_666_555_444_333_222n;
/** Term the mortgage/transfer witnesses prove is still available. */
const MIN_REQUIRED_TERM = 5n * SECONDS_PER_YEAR;

export interface SampleInput {
  input: ProofInput;
  /** Expected public-signal values, in PUBLIC_SIGNAL_ORDER[circuit] order (D21). */
  expectedPublicSignals: string[];
}

async function makeSubjectRecord(now: bigint): Promise<LURRecord> {
  return {
    propertyId: SUBJECT_PROPERTY_ID,
    ownerCommitment: await poseidonHash([SUBJECT_SECRET]),
    useType: UseType.RESIDENTIAL,
    validityPeriod: now + 10n * SECONDS_PER_YEAR,
    encumbranceStatus: EncumbranceStatus.FREE,
    tenureType: TenureType.FIXED_TERM,
    // Pinned: the sample witness exercises the predicates, not the digest.
    offchainHash: 555_666_777_888_999n,
  };
}

/** Place `record` in the middle of `fillerCount` random filler records. */
async function placeInTree(
  record: LURRecord,
  fillerCount = 6,
): Promise<{ tree: LURMerkleTree; allRecords: LURRecord[] }> {
  const { records: filler } = await generateMockRecords(fillerCount);
  const half = Math.floor(filler.length / 2);
  const allRecords = [...filler.slice(0, half), record, ...filler.slice(half)];
  const tree = await buildTree(allRecords);
  return { tree, allRecords };
}

/**
 * Build a valid witness + expected public signals for one circuit.
 *
 * @param opts.now `currentTimestamp` to bake into the witness (Unix seconds).
 *                 Defaults to wall-clock time; the Hardhat integration tests
 *                 pass the chain's block timestamp instead, since the on-chain
 *                 freshness check (D9/D26) compares against block.timestamp and
 *                 the two clocks diverge once tests manipulate chain time.
 */
export async function buildSampleInput(
  circuit: CircuitType,
  opts: { now?: bigint } = {},
): Promise<SampleInput> {
  const now = opts.now ?? nowUnixTimestamp();
  const record = await makeSubjectRecord(now);
  const { tree, allRecords } = await placeInTree(record);
  const proof = await generateMerkleProof(tree, record);

  if (circuit === 'ownership') {
    const input = buildOwnershipInput({
      record,
      ownerSecret: SUBJECT_SECRET,
      proof,
      currentTimestamp: now,
    });
    return {
      input,
      expectedPublicSignals: [tree.root, record.propertyId, record.ownerCommitment, now].map(
        String,
      ),
    };
  }

  if (circuit === 'mortgage') {
    const input = buildMortgageInput({
      record,
      ownerSecret: SUBJECT_SECRET,
      proof,
      currentTimestamp: now,
      minRequiredRemainingTerm: MIN_REQUIRED_TERM,
    });
    return {
      input,
      expectedPublicSignals: [
        tree.root,
        record.propertyId,
        record.ownerCommitment,
        now,
        MIN_REQUIRED_TERM,
      ].map(String),
    };
  }

  // transfer: swap ownerCommitment, rebuild the tree preserving order —
  // exactly the operation Phase 5's publish step performs.
  const newRecord: LURRecord = { ...record, ownerCommitment: await poseidonHash([BUYER_SECRET]) };
  const newRecords = allRecords.map((r) => (r.propertyId === record.propertyId ? newRecord : r));
  const newTree = await buildTree(newRecords);
  const newProof = await generateMerkleProof(newTree, newRecord);

  const input = buildTransferInput({
    oldRecord: record,
    newRecord,
    oldOwnerSecret: SUBJECT_SECRET,
    newOwnerSecret: BUYER_SECRET,
    oldProof: proof,
    newProof,
    currentTimestamp: now,
    minRequiredRemainingTerm: MIN_REQUIRED_TERM,
  });
  return {
    input,
    expectedPublicSignals: [
      tree.root,
      newTree.root,
      record.propertyId,
      record.ownerCommitment,
      newRecord.ownerCommitment,
      now,
      MIN_REQUIRED_TERM,
    ].map(String),
  };
}
