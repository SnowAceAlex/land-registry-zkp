import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  AttestationStaple,
  CircuitType,
  PUBLIC_SIGNAL_ORDER,
} from '@land-registry/blockchain/shared';

/**
 * proof.dto.ts — request bodies for the owner/verifier proof endpoints.
 *
 * `GET /api/proof/:propertyId` takes no body: the propertyId is the whole
 * request, and nothing private is involved (D39).
 */

/** The three circuit names, taken from PUBLIC_SIGNAL_ORDER so they cannot drift (D25). */
const CIRCUIT_TYPES = Object.keys(PUBLIC_SIGNAL_ORDER);

/** Widest and narrowest public-signal counts across the three circuits. */
const SIGNAL_COUNTS = Object.values(PUBLIC_SIGNAL_ORDER).map((order) => order.length);
const MIN_SIGNALS = Math.min(...SIGNAL_COUNTS);
const MAX_SIGNALS = Math.max(...SIGNAL_COUNTS);

export class VerifyProofDto {
  /**
   * Which circuit produced this proof. Optional: when omitted it is inferred
   * from how many public signals the proof carries (4/5/7 are distinct), which
   * is what lets a verifier accept a pasted proof without being told its type.
   * Supplying it anyway is checked against the count rather than trusted.
   */
  @ApiPropertyOptional({ enum: CIRCUIT_TYPES, example: 'ownership' })
  @IsOptional()
  @IsIn(CIRCUIT_TYPES)
  circuitType?: CircuitType;

  /**
   * Groth16 proof exactly as snarkjs emits it (`pi_a`, `pi_b`, `pi_c`,
   * `protocol`, `curve`). Generate one with
   * `pnpm --filter blockchain run owner:smoke <bundle-dir>` — it cannot be
   * written by hand.
   */
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { pi_a: ['...'], pi_b: [['...']], pi_c: ['...'], protocol: 'groth16', curve: 'bn128' },
  })
  @IsObject()
  proof!: Record<string, unknown>;

  /**
   * The public signals, in PUBLIC_SIGNAL_ORDER for the circuit (D21).
   * ownership: merkleRoot, propertyId, ownerCommitment, currentTimestamp.
   * mortgage adds minRequiredRemainingTerm; transfer has its own 7 (see §2.5).
   *
   * These are the ONLY things the proof discloses — everything else about the
   * record stayed in the owner's browser.
   */
  @ApiProperty({
    type: [String],
    minItems: MIN_SIGNALS,
    maxItems: MAX_SIGNALS,
    example: ['<merkleRoot>', '1', '<ownerCommitment>', '1785312000'],
  })
  @IsArray()
  @ArrayMinSize(MIN_SIGNALS)
  @ArrayMaxSize(MAX_SIGNALS)
  @IsString({ each: true })
  publicSignals!: string[];

  /**
   * The status attestation stapled to an ownership/mortgage proof (D82), from
   * `GET /api/proof/:propertyId/attestation`. Required for those two circuits;
   * the shape is checked by the service so a bad one is a 422 InvalidAttestation.
   */
  @ApiPropertyOptional({
    type: 'object',
    properties: { expiresAt: { type: 'string' }, signature: { type: 'string' } },
    example: { expiresAt: '1790000600', signature: '0x…' },
  })
  @IsOptional()
  @IsObject()
  attestation?: AttestationStaple;

  /**
   * Also verify through LandRegistryVerifier on chain. Off-chain verification
   * already applies the same three rules the contract does, so this is about
   * WHO attests: it costs an RPC round-trip and returns the contract's own
   * verdict rather than the backend's.
   */
  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  onChain?: boolean;
}
