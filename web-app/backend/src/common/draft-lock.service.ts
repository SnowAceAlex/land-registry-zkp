import { ConflictException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export type OpenDraft = { kind: 'issuance' | 'changeset'; id: number };

/**
 * DraftLockService — at most one open draft, across both draft types (D44).
 *
 * A Merkle root commits to the WHOLE tree, not just the leaves that changed, so
 * two drafts computed from the same base tree silently overwrite each other:
 * publish an issuance root and then a change-set root that was computed before
 * it, and the newly issued plots vanish from the tree with no error anywhere —
 * the second root is perfectly valid, it just commits to a tree that never had
 * them. The owner finds out when their brand-new bundle fails with RootMismatch.
 *
 * Serialising drafts removes the whole class of problem without any conflict
 * detection. A registry publishes serially in practice anyway, and publishing is
 * a manual, scheduled action (D46), so this almost never blocks anyone.
 */
@Injectable()
export class DraftLockService {
  constructor(private readonly prisma: PrismaService) {}

  async openDraft(): Promise<OpenDraft | null> {
    const issuance = await this.prisma.issuanceBatch.findFirst({
      where: { status: 'DRAFT' },
      select: { id: true },
    });
    if (issuance) return { kind: 'issuance', id: issuance.id };

    const changeSet = await this.prisma.changeSet.findFirst({
      where: { status: 'DRAFT' },
      select: { id: true },
    });
    if (changeSet) return { kind: 'changeset', id: changeSet.id };

    return null;
  }

  async assertNoOpenDraft(): Promise<void> {
    const open = await this.openDraft();
    if (!open) return;

    throw new ConflictException(
      `A ${open.kind} draft (#${open.id}) is still waiting to be signed. ` +
        `Confirm or discard it before starting another — two drafts computed from the same ` +
        `tree would overwrite each other's root.`,
    );
  }
}
