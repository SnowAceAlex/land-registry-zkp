import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ProofService } from './proof.service';
import { VerifyProofDto } from './dto/proof.dto';
import { MerkleProofResponseDto, VerifyProofResponseDto } from './dto/proof.response.dto';

/**
 * ProofController — `/api/proof/*`
 * ─────────────────────────────────────────────────────────────────────────────
 * The two endpoints the owner and verifier portals live on (Phase 8/9).
 *
 * ⚠️ NEITHER ROUTE IS GUARDED, on purpose (D39). Three reasons, worth stating
 * because the absence of a guard normally means someone forgot one:
 *
 *  1. The caller is a land owner, a buyer or a bank — not an officer. Reusing
 *     `GOV_API_KEY` here would be the wrong identity, and the browser portals
 *     of Phase 8/9 cannot hold the authority's key anyway.
 *  2. Authenticating "the owner" is circular in this design. The only thing
 *     that proves ownership is an ownership.circom proof, and producing one
 *     requires the very Merkle proof being requested.
 *  3. Nothing here is secret. Leaves and siblings are Poseidon hashes, the leaf
 *     position follows from the pinned propertyId order (D24), and
 *     `GET /api/records/:propertyId` already returns the owner commitment. The
 *     private witness — `ownerSecret` and the record fields — never reaches
 *     this server at all.
 *
 * Recorded in Limitations alongside D14 (the authority itself is mocked).
 */
@ApiTags('Proof')
@Controller('proof')
export class ProofController {
  constructor(private readonly proofService: ProofService) {}

  @Get(':propertyId')
  @ApiOperation({
    summary: 'Current Merkle proof for a property (refresh a stale bundle)',
    description:
      'Every published root invalidates the Merkle proof inside EVERY issued bundle, not just ' +
      'the record that changed — so a single transfer leaves all other owners holding a proof ' +
      'that no longer verifies. This re-issues the current one. No ownerSecret is involved: ' +
      'the response is public data, and the private witness stays in the owner browser. ' +
      'Compare `rootVersion` with the value in your receipt.json to detect staleness (§3.1).',
  })
  @ApiParam({ name: 'propertyId', example: '1', description: 'Decimal-string id' })
  @ApiOkResponse({ type: MerkleProofResponseDto })
  @ApiNotFoundResponse({ description: 'No property with that propertyId' })
  @ApiBadRequestResponse({ description: 'Property imported but not issued yet — it has no leaf' })
  @ApiServiceUnavailableResponse({ description: 'Cached proof does not verify; republish needed' })
  // Tighter than the 60/minute global default (AppModule): on a cache miss
  // (D40) this rebuilds the entire Merkle tree, the most expensive operation
  // any public route can trigger, so it gets its own smaller bucket.
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  getMerkleProof(@Param('propertyId') propertyId: string) {
    return this.proofService.getMerkleProof(propertyId);
  }

  @Post('verify')
  // POST because a proof is far too large for a query string, but nothing is
  // created — this is a question, and Nest's default 201 would say otherwise.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a Groth16 proof off-chain (and optionally on-chain)',
    description:
      'Applies the same three rules LandRegistryVerifier applies on chain, and rejects with the ' +
      'same names (D33): the proof must be cryptographically valid (InvalidProof), its ' +
      '`currentTimestamp` must be within ±10 minutes of now (StaleTimestamp — D26: a proof ' +
      'dated back to when an expired title was still valid verifies perfectly), and its root ' +
      'must be the current on-chain root (RootMismatch). The circuit type is inferred from the ' +
      'number of public signals when not given.',
  })
  @ApiOkResponse({ type: VerifyProofResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed body, or circuitType contradicts the signals' })
  @ApiUnprocessableEntityResponse({
    description: 'Proof rejected — body carries `reason`, `message` and optional `details`',
  })
  @ApiServiceUnavailableResponse({
    description: 'Trusted-setup artifacts missing on the server (run circuits:setup)',
  })
  verify(@Body() dto: VerifyProofDto) {
    return this.proofService.verify(dto);
  }
}
