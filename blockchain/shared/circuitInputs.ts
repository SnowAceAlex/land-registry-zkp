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

import { LURRecord, MerkleProofData, ProofInput, ProofPackage } from './types';
import { TREE_DEPTH } from './merkleTree';

/** The three circuits. Declared in types.ts; named here for the lookups below. */
export type CircuitType = ProofPackage['circuitType'];

/**
 * Public signal order per circuit — pinned here because Phase 4's
 * LandRegistryVerifier.sol indexes into the publicSignals array positionally.
 * These must match the `component main {public [...]}` declaration order in
 * each .circom file, which circuit tests assert against (D21).
 *
 * `satisfies` rather than a plain annotation: it keeps the literal tuple types
 * (so the arrays stay readonly and precisely typed) while still failing to
 * compile if a circuit exists in {@link CircuitType} but has no entry here —
 * a missing entry would otherwise surface as `undefined` at a lookup site.
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
} as const satisfies Record<CircuitType, readonly string[]>;

/**
 * Position of a named public signal within a circuit's `publicSignals` array.
 *
 * Every consumer that reaches into `publicSignals` — the backend verify
 * endpoint, the transfer flow, the Phase 9 portal — needs an index, and an
 * index written as a literal is D21 copied to another file. Looking it up by
 * name means renaming a signal in a .circom file breaks compilation here (the
 * only TS file that spells signal names) instead of silently reading the wrong
 * element somewhere else.
 *
 * @throws if the circuit has no signal by that name.
 */
export function publicSignalIndex(circuitType: CircuitType, signalName: string): number {
  const order = PUBLIC_SIGNAL_ORDER[circuitType] as readonly string[];
  const index = order.indexOf(signalName);
  if (index === -1) {
    throw new Error(
      `publicSignalIndex: circuit '${circuitType}' has no public signal '${signalName}' ` +
        `(it has: ${order.join(', ')})`,
    );
  }
  return index;
}

/**
 * The name of the signal carrying the root a verifier must compare against the
 * current on-chain root. `transfer` is the odd one out: its first root is the
 * OLD root — the new one is not published yet at verification time, which is
 * the whole point of the two-step flow (D28 / §3).
 */
export function rootSignalName(circuitType: CircuitType): string {
  return circuitType === 'transfer' ? 'oldMerkleRoot' : 'merkleRoot';
}

/**
 * Infer which circuit produced a proof from how many public signals it carries.
 *
 * The three counts (4 / 5 / 7) are distinct, so a bare proof package is
 * self-describing — which is what lets the verifier portal (Phase 9) accept a
 * pasted proof without being told its type. Derived from PUBLIC_SIGNAL_ORDER
 * rather than written as literals: adding a public signal to a circuit must not
 * leave a stale number here that quietly mis-identifies proofs.
 *
 * @throws if no circuit has that many public signals.
 */
export function circuitTypeForSignalCount(count: number): CircuitType {
  const matches = (Object.keys(PUBLIC_SIGNAL_ORDER) as CircuitType[]).filter(
    (circuit) => PUBLIC_SIGNAL_ORDER[circuit].length === count,
  );

  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    // Not reachable today (4/5/7 are distinct) but a new circuit could collide,
    // and guessing would be worse than saying so.
    throw new Error(
      `circuitTypeForSignalCount: ${count} public signals is ambiguous between ` +
        `${matches.join(' and ')} — the circuit type must be stated explicitly`,
    );
  }

  const known = (Object.keys(PUBLIC_SIGNAL_ORDER) as CircuitType[])
    .map((circuit) => `${circuit}=${PUBLIC_SIGNAL_ORDER[circuit].length}`)
    .join(', ');
  throw new Error(`circuitTypeForSignalCount: no circuit takes ${count} public signals (${known})`);
}

/**
 * Label a `publicSignals` array with the signal names of its circuit (D21).
 *
 * This is what a verifier is allowed to learn and no more: the public signals
 * ARE the selective disclosure, so naming them is how a UI shows "this proof
 * discloses the root, the property id, the commitment and a timestamp" without
 * inventing a per-circuit field list of its own.
 *
 * @throws if the array length does not match the circuit's signal count.
 */
export function describePublicSignals(
  circuitType: CircuitType,
  publicSignals: readonly string[],
): Record<string, string> {
  const order = PUBLIC_SIGNAL_ORDER[circuitType] as readonly string[];
  if (publicSignals.length !== order.length) {
    throw new Error(
      `describePublicSignals: circuit '${circuitType}' has ${order.length} public signals, ` +
        `got ${publicSignals.length}`,
    );
  }
  return Object.fromEntries(order.map((name, index) => [name, publicSignals[index]]));
}

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
