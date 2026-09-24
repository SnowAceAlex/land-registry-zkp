import { TransferRequest } from '@prisma/client';

import { TransferRequestDto } from './dto/transfer.response.dto';

/**
 * The one way a TransferRequest row leaves this API (D77).
 *
 * Between submit and the change set that archives it, the row holds the buyer's
 * secret, so handing the row back as-is would give that secret to anyone who
 * lists the queue. Same lesson as D50: the shape is what leaks. Every field is
 * named here, and a new column stays private until someone adds it on purpose.
 */
export function toTransferRequestDto(row: TransferRequest): TransferRequestDto {
  return {
    id: row.id,
    propertyId: row.propertyId,
    newOwnerCommitment: row.newOwnerCommitment,
    oldRoot: row.oldRoot,
    newRoot: row.newRoot,
    status: row.status,
    rejectReason: row.rejectReason,
    txHash: row.txHash,
    changeSetId: row.changeSetId,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}
