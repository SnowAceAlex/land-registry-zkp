import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
      'Compare `rootVersion` with the value in your receipt.json to detect staleness (§3.1). ' +
      'Cacheable: the response changes only when a root is published, so it carries an ETag ' +
      'keyed to the root version and answers 304 to a matching If-None-Match (D74).',
  })
  @ApiParam({ name: 'propertyId', example: '1', description: 'Decimal-string id' })
  @ApiOkResponse({ type: MerkleProofResponseDto })
  @ApiNotFoundResponse({ description: 'No property with that propertyId' })
  @ApiBadRequestResponse({ description: 'Property imported but not issued yet — it has no leaf' })
  @ApiServiceUnavailableResponse({ description: 'Node table inconsistent; run tree:bootstrap' })
  async getMerkleProof(
    @Param('propertyId') propertyId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MerkleProofResponseDto | undefined> {
    // The service validates the plot BEFORE honouring `If-None-Match` — the
    // validator is guessable, so a conditional request must not be able to skip
    // the 404 / 400 / 410 answers. See ProofService.conditionalProof.
    const { etag, proof } = await this.proofService.conditionalProof(propertyId, ifNoneMatch);

    // No validator means the body describes a tree the chain has already moved
    // past (inSync: false) — never let anything cache that. See conditionalProof.
    if (etag === undefined) {
      res.setHeader('Cache-Control', 'no-store');
      return proof;
    }

    res.setHeader('ETag', etag);
    // A short max-age because the next publish cannot be predicted; correctness
    // rests on the ETag, and max-age only shaves off the revalidation round
    // trips in between.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');

    if (!proof) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return proof;
  }

  @Post('verify')
  // POST because a proof is far too large for a query string, but nothing is
  // created — this is a question, and Nest's default 201 would say otherwise.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a Groth16 proof off-chain (and optionally on-chain)',
    description:
      'Applies the same four rules LandRegistryVerifier applies on chain, and rejects with the ' +
      'same names (D33/D81): the proof must be cryptographically valid (InvalidProof), its ' +
      '`currentTimestamp` must be within ±10 minutes of now (StaleTimestamp — D26: a proof ' +
      'dated back to when an expired title was still valid verifies perfectly), its root ' +
      'must be the current on-chain root (RootMismatch), and — ownership/mortgage only — the ' +
      'owner must not be frozen by an open procedure (OwnerFrozen). The circuit type is inferred ' +
      'from the number of public signals when not given.',
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
