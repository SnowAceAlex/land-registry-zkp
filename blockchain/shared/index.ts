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

// Off-chain metadata commitment (7th leaf input)
export * from './offchainMetadata';

// Merkle Tree utilities (Poseidon-based)
export * from './merkleTree';

// Circuit witness input builders (single source of circuit signal names — D25)
export * from './circuitInputs';

// Date/timezone helpers (UTC+7 at the edges, Unix epoch in-circuit — D10)
export * from './datetime';

// ZKP / snarkjs Groth16 wrapper
export * from './zkpHelper';
