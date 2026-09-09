import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PropertyEventService } from './property-event.service';
import { PropertyHistoryResponseDto } from './dto/history.response.dto';

/**
 * HistoryController — the public change log of one plot (D48).
 *
 * Deliberately unguarded, on the same reasoning as D39: every field returned is
 * either a pseudonymous commitment (D8), a Poseidon hash, or — for a REVOKED
 * event's `detail` — the small on-chain reason code plus keccak256(detailText).
 * The free-text revocation reason itself is never returned here: the design
 * deliberately keeps it off the blockchain (a permanent public record of *why*
 * a specific plot lost its certificate is legally sensitive), so this endpoint
 * must not become the leak that undoes that. With that guarantee, this
 * discloses nothing that `GET /api/records/:propertyId` does not already
 * disclose. A buyer being able to check a plot's history themselves — rather
 * than taking an officer's word for it — is the point.
 */
@ApiTags('records')
@Controller('records')
export class HistoryController {
  constructor(private readonly events: PropertyEventService) {}

  @Get(':propertyId/history')
  @ApiOperation({
    summary: 'Public change history of one property',
    description:
      'Every change that altered the leaf: issuance, transfer, revocation, encumbrance and ' +
      'validity changes. Oldest first. No authentication — the data is pseudonymous.',
  })
  async history(@Param('propertyId') propertyId: string): Promise<PropertyHistoryResponseDto> {
    const events = await this.events.listFor(propertyId);
    return {
      propertyId,
      events: events.map((event) => ({
        kind: event.kind,
        rootVersion: event.rootVersion,
        txHash: event.txHash,
        previousOwnerCommitment: event.previousOwnerCommitment,
        newOwnerCommitment: event.newOwnerCommitment,
        previousLeaf: event.previousLeaf,
        newLeaf: event.newLeaf,
        detail: event.detail,
        occurredAt: event.occurredAt,
      })),
    };
  }
}
