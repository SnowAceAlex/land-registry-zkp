/**
 * lib/proof-file.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Read a `proof.json` — a Groth16 proof plus its public signals — from what a
 * verifier hands the browser: an uploaded file or pasted text.
 *
 * Sibling of `bundle.ts`, same division of labour: only the SHAPE is checked
 * here, and this module does no crypto. Whether the proof is valid, fresh and
 * against the current root is the four-check pipeline's job (D63).
 *
 * Used from both ends (D66): `/resident/verify` parses what it is given, and
 * `/resident/proof` runs the same validation over the package it is about to
 * offer for download, so a file this system emits is a file it can read back.
 *
 * `circuitType` is optional in the file. The count of public signals already
 * determines the circuit — 4 ownership, 5 mortgage, 7 transfer — so a file
 * without it is still readable; a file whose declared type contradicts its
 * signal count has been edited, and is rejected rather than reinterpreted.
 */

// Subpath imports, not the barrel: the barrel re-exports merkleTree.ts and its
// circomlibjs, which this module has no use for — it does no crypto at all.
import {
  PUBLIC_SIGNAL_ORDER,
  type CircuitType,
  circuitTypeForSignalCount,
} from '@land-registry/blockchain/shared/circuitInputs';
import type { Groth16Proof, ProofPackage } from '@land-registry/blockchain/shared/types';
import type { AttestationStaple } from '@land-registry/blockchain/shared/statusAttestation';

export type ProofFileErrorCode =
  'invalid-json' | 'invalid-shape' | 'unknown-circuit' | 'circuit-mismatch';

export class ProofFileError extends Error {
  constructor(
    readonly code: ProofFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProofFileError';
  }
}

const DECIMAL = /^\d+$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/** The signal counts this system's circuits produce, for error copy. */
export function signalCountsByCircuit(): { circuitType: CircuitType; count: number }[] {
  return (Object.keys(PUBLIC_SIGNAL_ORDER) as CircuitType[]).map((circuitType) => ({
    circuitType,
    count: PUBLIC_SIGNAL_ORDER[circuitType].length,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every field element in a proof is a decimal string — snarkjs emits them so. */
function decimalTuple(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === 'string' && DECIMAL.test(item))
  );
}

function readProof(value: unknown): Groth16Proof {
  if (!isRecord(value)) {
    throw new ProofFileError('invalid-shape', 'The `proof` field is missing or not an object');
  }
  // snarkjs emits pi_a and pi_c as 3 coordinates (the third is the projective
  // marker) and pi_b as 3 pairs. toSolidityCalldata drops the markers, so the
  // file keeps them and this check expects them.
  if (!decimalTuple(value.pi_a, 3) || !decimalTuple(value.pi_c, 3)) {
    throw new ProofFileError(
      'invalid-shape',
      'proof.pi_a and proof.pi_c must each be 3 decimal strings',
    );
  }
  if (
    !Array.isArray(value.pi_b) ||
    value.pi_b.length !== 3 ||
    !value.pi_b.every((pair) => decimalTuple(pair, 2))
  ) {
    throw new ProofFileError('invalid-shape', 'proof.pi_b must be 3 pairs of decimal strings');
  }
  return value as unknown as Groth16Proof;
}

function readPublicSignals(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProofFileError('invalid-shape', '`publicSignals` must be a non-empty array');
  }
  if (!value.every((signal) => typeof signal === 'string' && DECIMAL.test(signal))) {
    throw new ProofFileError('invalid-shape', 'Every public signal must be a decimal string');
  }
  return value as string[];
}

function readCircuitType(declared: unknown, signalCount: number): CircuitType {
  // The signal count is the ground truth: it is what the verifying key and the
  // contract's uint[4|5|7] argument are shaped by.
  let inferred: CircuitType;
  try {
    inferred = circuitTypeForSignalCount(signalCount);
  } catch {
    const counts = signalCountsByCircuit()
      .map(({ circuitType, count }) => `${count} (${circuitType})`)
      .join(', ');
    throw new ProofFileError(
      'unknown-circuit',
      `${signalCount} public signals match no circuit in this registry — expected ${counts}`,
    );
  }

  if (declared !== undefined && declared !== inferred) {
    throw new ProofFileError(
      'circuit-mismatch',
      `The file says circuitType "${String(declared)}" but carries ${signalCount} public ` +
        `signals, which is ${inferred}. The file has been edited.`,
    );
  }
  return inferred;
}

/**
 * The stapled status attestation (D82), when there is one. A missing one is
 * not a shape error: the five-check pipeline reports it as InvalidAttestation.
 */
function readAttestation(value: unknown): AttestationStaple | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !isRecord(value) ||
    typeof value.expiresAt !== 'string' ||
    !DECIMAL.test(value.expiresAt) ||
    typeof value.signature !== 'string' ||
    !SIGNATURE.test(value.signature)
  ) {
    throw new ProofFileError(
      'invalid-shape',
      '`attestation` must be { expiresAt: decimal string, signature: 65-byte hex }',
    );
  }
  return { expiresAt: value.expiresAt, signature: value.signature };
}

/**
 * Validate an object that is already in hand.
 *
 * Extra keys are tolerated: `proof:bodies` and `transfer:smoke` write a
 * ready-to-POST verify body (`{circuitType, proof, publicSignals, onChain}`),
 * and that file should be readable here without a special case.
 */
export function assertProofPackage(value: unknown): ProofPackage {
  if (!isRecord(value)) {
    throw new ProofFileError('invalid-shape', 'A proof file must be a JSON object');
  }

  const proof = readProof(value.proof);
  const publicSignals = readPublicSignals(value.publicSignals);
  const circuitType = readCircuitType(value.circuitType, publicSignals.length);
  // Transfers carry none (verifyTransfer takes no attestation), so one is ignored there.
  const attestation = circuitType === 'transfer' ? undefined : readAttestation(value.attestation);

  return attestation
    ? { proof, publicSignals, circuitType, attestation }
    : { proof, publicSignals, circuitType };
}

/** Parse uploaded or pasted text into a proof package. */
export function parseProofFile(text: string): ProofPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProofFileError('invalid-json', 'That is not valid JSON');
  }
  return assertProofPackage(parsed);
}
