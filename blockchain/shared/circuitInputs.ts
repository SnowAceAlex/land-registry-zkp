/**
 * shared/circuitInputs.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the witness input objects for the three Groth16 circuits.
 *
 * ⚠️  DESIGN RULE (D25): this is the ONLY place circuit signal names are
 *     spelled out in TypeScript. Circuit tests, the trusted-setup scripts, the
 *     backend and the browser prover all go through here. Rename a signal in a
 *     .circom file and exactly one TS file breaks, loudly — instead of four
 *     call sites drifting apart quietly.
 *
 * Every value is emitted as a decimal string. snarkjs also accepts bigints, but
 * these objects get JSON-serialised on the way to the browser (Phase 8) and
 * JSON has no bigint, so stringify once here rather than at each boundary.
 *
 * PRIVACY: the returned objects contain `ownerSecret` and the full record.
 * They are witness input — they must never leave the owner's browser. Only the
 * resulting proof + public signals are shareable.
 */

import { LURRecord, MerkleProofData, ProofInput } from './types';
import { TREE_DEPTH } from './merkleTree';

/**
 * Public signal order per circuit — pinned here because Phase 4's
 * LandRegistryVerifier.sol indexes into the publicSignals array positionally.
 * These must match the `component main {public [...]}` declaration order in
 * each .circom file, which circuit tests assert against (D21).
 */
export const PUBLIC_SIGNAL_ORDER = {
  ownership: ['merkleRoot', 'propertyId', 'ownerCommitment', 'currentTimestamp'],
  mortgage: [
    'merkleRoot',
    'propertyId',
    'ownerCommitment',
    'currentTimestamp',
    'minRequiredRemainingTerm',
  ],
  transfer: [
    'oldMerkleRoot',
    'newMerkleRoot',
    'propertyId',
    'oldOwnerCommitment',
    'newOwnerCommitment',
    'currentTimestamp',
    'minRequiredRemainingTerm',
  ],
} as const;

/** Reject a proof that isn't the fixed depth the circuits are compiled for. */
function assertProofDepth(proof: MerkleProofData, label: string): void {
  if (proof.siblings.length !== TREE_DEPTH || proof.pathIndices.length !== TREE_DEPTH) {
    throw new Error(
      `${label}: expected a depth-${TREE_DEPTH} Merkle proof, got ` +
        `${proof.siblings.length} siblings / ${proof.pathIndices.length} pathIndices`,
    );
  }
}

/** The record fields shared by every circuit's private witness. */
function recordFields(record: LURRecord) {
  return {
    useType: record.useType.toString(),
    validityPeriod: record.validityPeriod.toString(),
    encumbranceStatus: record.encumbranceStatus.toString(),
    tenureType: record.tenureType.toString(),
    // Private: commits the leaf to the descriptive fields without exposing them
    // (see shared/offchainMetadata.ts). Not a public signal, so D21 is unchanged.
    offchainHash: record.offchainHash.toString(),
  };
}

export interface OwnershipInputParams {
  record: LURRecord;
  ownerSecret: bigint;
  proof: MerkleProofData;
  /** Unix seconds. Public input; on-chain it is checked against block.timestamp (D9). */
  currentTimestamp: bigint;
}

/**
 * Witness input for ownership.circom — "I hold this property and it is not expired".
 * Public: merkleRoot, propertyId, ownerCommitment, currentTimestamp.
 */
export function buildOwnershipInput(params: OwnershipInputParams): ProofInput {
  const { record, ownerSecret, proof, currentTimestamp } = params;
  assertProofDepth(proof, 'buildOwnershipInput');

  return {
    merkleRoot: proof.root.toString(),
    propertyId: record.propertyId.toString(),
    ownerCommitment: record.ownerCommitment.toString(),
    currentTimestamp: currentTimestamp.toString(),
    ...recordFields(record),
    ownerSecret: ownerSecret.toString(),
    siblings: proof.siblings.map((s) => s.toString()),
    pathIndices: proof.pathIndices.map((i) => i.toString()),
  };
}

export interface MortgageInputParams extends OwnershipInputParams {
  /** Seconds of remaining term the owner chooses to prove they still have (D16). */
  minRequiredRemainingTerm: bigint;
}

/**
 * Witness input for mortgage.circom — "this title is encumbrance-free and has at
 * least N seconds of term left", without revealing the actual expiry date (D6).
 * Public: merkleRoot, propertyId, ownerCommitment, currentTimestamp, minRequiredRemainingTerm.
 */
export function buildMortgageInput(params: MortgageInputParams): ProofInput {
  return {
    ...buildOwnershipInput(params),
    minRequiredRemainingTerm: params.minRequiredRemainingTerm.toString(),
  };
}

export interface TransferInputParams {
  oldRecord: LURRecord;
  newRecord: LURRecord;
  oldOwnerSecret: bigint;
  newOwnerSecret: bigint;
  oldProof: MerkleProofData;
  newProof: MerkleProofData;
  /** Unix seconds. Public input; checked against block.timestamp on-chain (D9). */
  currentTimestamp: bigint;
  /**
   * Seconds of remaining term the buyer acknowledges they are acquiring (D27).
   * Pass 0n to assert only "not expired" without committing to a term length.
   */
  minRequiredRemainingTerm: bigint;
}

/**
 * Witness input for transfer.circom — "ownership moved from A to B, nothing else
 * about the record changed, the land is unencumbered and still has term left",
 * proven against the old and new Merkle roots.
 * Public: oldMerkleRoot, newMerkleRoot, propertyId, oldOwnerCommitment,
 *         newOwnerCommitment, currentTimestamp, minRequiredRemainingTerm.
 */
export function buildTransferInput(params: TransferInputParams): ProofInput {
  const {
    oldRecord,
    newRecord,
    oldOwnerSecret,
    newOwnerSecret,
    oldProof,
    newProof,
    currentTimestamp,
    minRequiredRemainingTerm,
  } = params;
  assertProofDepth(oldProof, 'buildTransferInput (old)');
  assertProofDepth(newProof, 'buildTransferInput (new)');

  // The circuit derives both leaves from a single set of record-field signals,
  // so a transfer that also mutated useType/validityPeriod/etc. simply cannot
  // be proven. Catch that here with a readable error instead of letting the
  // caller hit an opaque "Assert Failed" from the witness calculator.
  const unchanged: (keyof LURRecord)[] = [
    'propertyId',
    'useType',
    'validityPeriod',
    'encumbranceStatus',
    'tenureType',
    // Both leaves are hashed from one set of record signals, so a transfer that
    // also rewrote the address or area is unprovable by construction.
    'offchainHash',
  ];
  for (const field of unchanged) {
    if (oldRecord[field] !== newRecord[field]) {
      throw new Error(
        `buildTransferInput: a transfer may only change ownerCommitment, but ` +
          `${field} differs (${oldRecord[field]} -> ${newRecord[field]})`,
      );
    }
  }

  return {
    oldMerkleRoot: oldProof.root.toString(),
    newMerkleRoot: newProof.root.toString(),
    propertyId: oldRecord.propertyId.toString(),
    oldOwnerCommitment: oldRecord.ownerCommitment.toString(),
    newOwnerCommitment: newRecord.ownerCommitment.toString(),
    currentTimestamp: currentTimestamp.toString(),
    minRequiredRemainingTerm: minRequiredRemainingTerm.toString(),
    ...recordFields(oldRecord),
    oldOwnerSecret: oldOwnerSecret.toString(),
    newOwnerSecret: newOwnerSecret.toString(),
    oldSiblings: oldProof.siblings.map((s) => s.toString()),
    oldPathIndices: oldProof.pathIndices.map((i) => i.toString()),
    newSiblings: newProof.siblings.map((s) => s.toString()),
    newPathIndices: newProof.pathIndices.map((i) => i.toString()),
  };
}
