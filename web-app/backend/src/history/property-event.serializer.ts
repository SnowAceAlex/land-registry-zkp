import { PropertyEvent } from '@prisma/client';

import { PropertyEventDto } from './dto/history.response.dto';

// Enumerated on purpose: a new PropertyEvent column must not become public by default.
export function toPropertyEventDto(event: PropertyEvent): PropertyEventDto {
  return {
    kind: event.kind,
    rootVersion: event.rootVersion,
    txHash: event.txHash,
    previousOwnerCommitment: event.previousOwnerCommitment,
    newOwnerCommitment: event.newOwnerCommitment,
    previousLeaf: event.previousLeaf,
    newLeaf: event.newLeaf,
    detail: event.detail,
    occurredAt: event.occurredAt,
  };
}
