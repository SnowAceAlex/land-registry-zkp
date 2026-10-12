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

// receipt.json wire format + the single receipt → LURRecord reconstruction
export * from './receipt';

// D30 issuer identity chain: the D34 signature rule, cert org name, verify
export * from './issuerIdentity';

// deployments/<network>.json record + RPC endpoint resolution
export * from './deployments';

// Merkle Tree utilities (Poseidon-based)
export * from './merkleTree';

// Incremental sparse-tree engine: proofs and projections over a node reader (D72)
export * from './sparseTree';

// Circuit witness input builders (single source of circuit signal names — D25)
export * from './circuitInputs';

// Date/timezone helpers (UTC+7 at the edges, Unix epoch in-circuit — D10)
export * from './datetime';

// Backend-signed status attestation stapled to ownership/mortgage proofs (D82)
export * from './statusAttestation';

// ZKP / snarkjs Groth16 wrapper
export * from './zkpHelper';
