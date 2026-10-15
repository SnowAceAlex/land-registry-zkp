import { Revocation } from '@prisma/client';

import { isFallback } from '../common/office-scope';
import { RevocationDto } from './dto/revocation.response.dto';

// D50: every field is named, so a new column stays private until someone adds it here.
export function toRevocationDto(row: Revocation, offices: Map<number, string>): RevocationDto {
  return {
    id: row.id,
    propertyId: row.propertyId,
    reasonCode: row.reasonCode,
    detailText: row.detailText,
    detailHash: row.detailHash,
    status: row.status,
    officeCode: offices.get(row.officeId) ?? null,
    landOfficeCode: row.landOfficeId === null ? null : (offices.get(row.landOfficeId) ?? null),
    byFallback: isFallback(row.officeId, row.landOfficeId),
    held: row.heldAt !== null,
    heldReason: row.heldReason,
    changeSetId: row.changeSetId,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
  };
}
