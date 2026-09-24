import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TREE_DEPTH } from '@land-registry/blockchain/shared';

/**
 * proof.response.dto.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Response shapes for the owner/verifier proof endpoints.
 *
 * Same convention as the government DTOs: every BN254 field element (roots,
 * leaves, commitments, property ids, siblings) is a DECIMAL STRING, because
 * these values exceed Number.MAX_SAFE_INTEGER and JSON has no bigint.
 */

const EXAMPLE_ROOT = '5677530015593700534173836181788122415198283309363871298832210090950018556857';
const EXAMPLE_LEAF = '1817430220284577118172530372107574201063966418741744604374425932893563372963';

export class ChainRootDto {
  @ApiProperty({ example: EXAMPLE_ROOT, description: 'RootRegistry.latestRoot(), decimal' })
  root!: string;

  @ApiProperty({ example: 2, description: 'RootRegistry.rootVersion(); 0 = nothing published' })
  version!: number;
}

export class MerkleProofResponseDto {
  @ApiProperty({ example: '1' })
  propertyId!: string;

  /** Poseidon hash of the 7 leaf fields (D4/D36), recomputed from current state. */
  @ApiProperty({ example: EXAMPLE_LEAF })
  leaf!: string;

  /** Root of the tree this proof was generated against. */
  @ApiProperty({ example: EXAMPLE_ROOT })
  merkleRoot!: string;

  /**
   * The on-chain version `merkleRoot` corresponds to, and the value to write
   * into a refreshed `receipt.json` (§3.1).
   *
   * Null when `inSync` is false: the tree the database currently implies has
   * not been published, so its root has no version yet.
   */
  @ApiPropertyOptional({ example: 2, nullable: true })
  rootVersion!: number | null;

  @ApiProperty({
    type: [String],
    minItems: TREE_DEPTH,
    maxItems: TREE_DEPTH,
    description: `Sibling hash per level, leaf → root (${TREE_DEPTH} levels)`,
  })
  siblings!: string[];

  @ApiProperty({
    type: [Number],
    minItems: TREE_DEPTH,
    maxItems: TREE_DEPTH,
    description: '0 = the running node is the left input at this level, 1 = the right',
  })
  pathIndices!: number[];

  /** RootRegistry the root above belongs to — lets a reader check they agree. */
  @ApiProperty({ example: '0x5FbDB2315678afecb367f032d93F642f64180aa3' })
  contractAddress!: string;

  @ApiProperty({ type: ChainRootDto })
  onChain!: ChainRootDto;

  /**
   * True when the tree rebuilt from the database has the root the chain holds.
   *
   * False is not a failure of this endpoint — it means the registry has changes
   * that are not published yet, so this proof will only start verifying once
   * someone publishes the next root.
   */
  @ApiProperty({ example: true })
  inSync!: boolean;

  /**
   * Where the proof came from. Since D72 the tree is stored in `merkle_nodes`,
   * so there is exactly one source: the proof is read out of the node table.
   * The field stays so an existing client keeps parsing, and so a second source
   * would have somewhere to declare itself.
   */
  @ApiProperty({ example: 'nodes', enum: ['nodes'] })
  source!: 'nodes';
}

export class ProofChecksDto {
  /** groth16.verify() — the witness satisfied the circuit. */
  @ApiProperty({ example: true })
  cryptographic!: boolean;

  /** `currentTimestamp` is within ±10 minutes of now (D26). */
  @ApiProperty({ example: true })
  freshness!: boolean;

  /** The root signal equals RootRegistry.latestRoot(). */
  @ApiProperty({ example: true })
  rootMatchesChain!: boolean;

  /** LandRegistryVerifier's own verdict; null when `onChain` was not requested. */
  @ApiPropertyOptional({ example: null, nullable: true })
  onChain!: boolean | null;
}

export class VerifyProofResponseDto {
  /**
   * Always true on a 200 — a rejected proof is a 422 carrying `reason`
   * (InvalidProof / RootMismatch / StaleTimestamp, the same taxonomy the
   * contract reverts with, D33). Kept so a client can branch on one field
   * regardless of which layer answered.
   */
  @ApiProperty({ example: true })
  valid!: boolean;

  @ApiProperty({ example: 'ownership', enum: ['ownership', 'mortgage', 'transfer'] })
  circuitType!: string;

  @ApiProperty({ type: ProofChecksDto })
  checks!: ProofChecksDto;

  /**
   * The public signals, labelled with their circuit signal names (D21).
   *
   * This IS the selective disclosure: a verifier learns these values and
   * nothing else — not the expiry date, not the address, not the area. An
   * ownership proof discloses four values; a mortgage proof adds only the
   * threshold the owner chose to clear, never the actual remaining term (D6/D16).
   */
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: {
      merkleRoot: EXAMPLE_ROOT,
      propertyId: '1',
      ownerCommitment: '19897067188519289101513059926301937407996214561223222508148918589381936293',
      currentTimestamp: '1785312000',
    },
  })
  disclosed!: Record<string, string>;
}
