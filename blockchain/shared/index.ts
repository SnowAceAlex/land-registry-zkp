/**
 * shared/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Main entry point for the @land-registry/blockchain shared module.
 *
 * Import in backend/frontend via:
 *   import { LURRecord, buildTree, generateGroth16Proof } from '@land-registry/blockchain/shared'
 */

// Types & Enums
export * from './types';

// Merkle Tree utilities (Poseidon-based)
export * from './merkleTree';

// ZKP / snarkjs Groth16 wrapper
export * from './zkpHelper';
