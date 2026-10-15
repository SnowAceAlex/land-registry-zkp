import { IssuanceRequest } from '@prisma/client';

import { IssuanceRequestDto } from './dto/issuance-request.dto';

// The row holds ownerSecret until the archive is written, so every field is named (D77/D50).
export function toIssuanceRequestDto(
  row: IssuanceRequest,
  offices: Map<number, string>,
): IssuanceRequestDto {
  return {
    id: row.id,
    propertyId: row.propertyId,
    ownerCommitment: row.ownerCommitment,
    status: row.status,
    officeCode: offices.get(row.officeId) ?? '',
    landOfficeCode: row.landOfficeId === null ? null : (offices.get(row.landOfficeId) ?? null),
    held: row.heldAt !== null,
    heldReason: row.heldReason,
    changeSetId: row.changeSetId,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
  };
}
