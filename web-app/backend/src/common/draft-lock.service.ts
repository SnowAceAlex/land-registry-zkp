import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type OpenDraft = { kind: 'changeset'; id: number };

/** The service's own client, or the transaction createDraft holds its advisory lock in. */
type DraftClient = Pick<Prisma.TransactionClient, 'changeSet'>;

/**
 * DraftLockService — at most one open draft (D44).
 *
 * A Merkle root commits to the WHOLE tree, so two drafts computed from the same
 * base tree silently overwrite each other: publish one root and then another
 * computed before it, and the first round's changes vanish from the tree with
 * no error anywhere. Serialising drafts removes that class of problem without
 * conflict detection; publishing is a manual, scheduled action (D46), so this
 * almost never blocks anyone.
 */
@Injectable()
export class DraftLockService {
  constructor(private readonly prisma: PrismaService) {}

  async openDraft(client: DraftClient = this.prisma): Promise<OpenDraft | null> {
    const changeSet = await client.changeSet.findFirst({
      where: { status: 'DRAFT' },
      select: { id: true },
    });
    return changeSet ? { kind: 'changeset', id: changeSet.id } : null;
  }

  async assertNoOpenDraft(client: DraftClient = this.prisma): Promise<void> {
    const open = await this.openDraft(client);
    if (!open) return;

    throw new ConflictException(
      `A ${open.kind} draft (#${open.id}) is still waiting to be signed. ` +
        `Confirm or discard it before starting another — two drafts computed from the same ` +
        `tree would overwrite each other's root.`,
    );
  }
}
