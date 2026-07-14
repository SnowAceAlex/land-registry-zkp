/**
 * shared/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Central type definitions shared across blockchain, backend, and frontend.
 * Import via: import { LURRecord, ProofInput } from '@land-registry/blockchain/shared'
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Roles for access control in the system.
 * Maps to AccessControl roles in RootRegistry.sol.
 */
export enum RoleType {
  STATE_AUTHORITY = 'STATE_AUTHORITY',
  LAND_OWNER = 'LAND_OWNER',
  BANK_VERIFIER = 'BANK_VERIFIER',
  PUBLIC_VERIFIER = 'PUBLIC_VERIFIER',
}

/**
 * Land use type classification for LUR records.
 * Numeric values correspond to on-chain / circuit encoding.
 */
export enum UseType {
  RESIDENTIAL = 0,
  AGRICULTURAL = 1,
  COMMERCIAL = 2,
  INDUSTRIAL = 3,
  FORESTRY = 4,
}

/**
 * Encumbrance / mortgage status of a property.
 */
export enum EncumbranceStatus {
  FREE = 0,           // No encumbrance
  MORTGAGED = 1,      // Under mortgage
  LITIGATED = 2,      // Subject to legal dispute
  RESTRICTED = 3,     // Restricted transfer (e.g., planning zone)
}

/**
 * Land tenure classification (D2) — determines whether validityPeriod is
 * meaningful. Cannot be derived from useType alone (e.g. AGRICULTURAL can be
 * either PERPETUAL or FIXED_TERM), so it's assigned explicitly by the
 * backend at record-issue time based on the detailed land use code.
 */
export enum TenureType {
  PERPETUAL = 0,          // ONT, ODT, community agricultural land — no time-check
  FIXED_TERM = 1,         // annual/perennial crop land, production forest, aquaculture/salt — 50 years
  PROJECT_LEASEHOLD = 2,  // TMD, SKC — up to 50/70 years depending on project
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Record Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full Land Use Rights (LUR) record.
 * All bigint fields correspond to field elements used in Poseidon hashing.
 *
 * IMPORTANT: ownerCommitment = Poseidon([ownerSecret]) — never store ownerSecret here.
 */
export interface LURRecord {
  /** Unique property identifier (numeric, maps to a DB id or cadastral code) */
  propertyId: bigint;

  /**
   * Poseidon commitment to the owner's identity.
   * Computed off-chain as: Poseidon([ownerSecret])
   * The owner's secret is NEVER stored or transmitted.
   */
  ownerCommitment: bigint;

  /** Land use type — see UseType enum */
  useType: UseType;

  /**
   * Validity period of the LUR in Unix timestamp (end date).
   * E.g., 2048-01-01 = 2461449600
   * Sentinel: 0n when tenureType === TenureType.PERPETUAL (D5) — circuits skip the time-check in that case.
   */
  validityPeriod: bigint;

  /** Encumbrance status — see EncumbranceStatus enum */
  encumbranceStatus: EncumbranceStatus;

  /** Land tenure classification — see TenureType enum */
  tenureType: TenureType;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZKP / Circuit Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input object passed to the snarkjs prover for any circuit.
 * Fields are circuit-specific; this is a flexible base type.
 * All numeric values must be stringified bigints for snarkjs compatibility.
 */
export interface ProofInput {
  [key: string]: string | string[] | bigint | bigint[];
}

/**
 * Groth16 proof as output by snarkjs.
 * Matches the structure returned by snarkjs.groth16.fullProve().
 */
export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: string;
}

/**
 * Public signals output by the circuit prover.
 * Array of stringified bigints — circuit-specific ordering.
 */
export type PublicSignals = string[];

/**
 * Complete proof package returned to a verifier.
 */
export interface ProofPackage {
  proof: Groth16Proof;
  publicSignals: PublicSignals;
  /** Which circuit generated this proof */
  circuitType: 'ownership' | 'mortgage' | 'transfer';
}

// ─────────────────────────────────────────────────────────────────────────────
// Merkle Tree Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Merkle inclusion proof for a single LUR record leaf.
 * Passed as private input to circuits and can also verify on-chain.
 */
export interface MerkleProofData {
  /** The leaf hash: Poseidon(record fields) */
  leaf: bigint;

  /** Sibling hashes at each tree level (bottom-up) */
  siblings: bigint[];

  /**
   * Path direction at each level:
   *   0 = current node is the LEFT child (sibling is on the right)
   *   1 = current node is the RIGHT child (sibling is on the left)
   */
  pathIndices: number[];

  /** The Merkle root computed from this proof */
  root: bigint;
}

/**
 * Record attributes used for selective disclosure.
 * A verifier request specifies which fields they need proven.
 */
export interface RecordAttributes {
  propertyId?: boolean;
  ownerCommitment?: boolean;
  useType?: boolean;
  validityPeriod?: boolean;
  encumbranceStatus?: boolean;
  tenureType?: boolean;
}
