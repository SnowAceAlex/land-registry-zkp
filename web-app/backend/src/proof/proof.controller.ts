import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProofService } from './proof.service';

/**
 * ProofController
 * ─────────────────────────────────────────────────────────────────────────────
 * REST endpoints for Merkle proof issuance and verification.
 * Base path: /api/proof
 *
 * Planned endpoints:
 *   GET  /api/proof/:propertyId     — generate a Merkle proof for a property
 *   POST /api/proof/verify           — verify a submitted proof off-chain
 *
 * TODO:
 *  1. Add authentication guard (only the property owner can request their proof)
 *  2. Add rate limiting to prevent abuse
 *  3. Add response DTO with the MerkleProofData fields + circuit input format
 */
@ApiTags('Proof')
@Controller('proof')
export class ProofController {
  constructor(private readonly proofService: ProofService) {}

  @Get(':propertyId')
  @ApiOperation({
    summary: 'Not implemented yet — Phase 6',
    description:
      'Will re-issue the current Merkle proof for a property so owners can refresh a stale ' +
      'one. Until then the cached proof is refreshed on every root publish and travels in the ' +
      'issued bundle.',
    deprecated: true,
  })
  generateProof(@Param('propertyId') propertyId: string) {
    // TODO: add auth guard — verify caller owns this property
    return this.proofService.generateProof(propertyId);
  }

  @Post('verify')
  @ApiOperation({
    summary: 'Not implemented yet — Phase 6',
    description:
      'Off-chain verification on behalf of a client. Must call assertTimestampFresh (D26): ' +
      'groth16.verify() returns true for a replayed proof dated years ago.',
    deprecated: true,
  })
  verifyProof(@Body() body: unknown) {
    // TODO: define VerifyProofDto
    return this.proofService.verifyProof(body);
  }
}
