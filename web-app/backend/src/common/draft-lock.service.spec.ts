import { ConflictException } from '@nestjs/common';

import { DraftLockService } from './draft-lock.service';

describe('DraftLockService (D44)', () => {
  const changeSetFind = jest.fn();
  const prisma = { changeSet: { findFirst: changeSetFind } } as never;
  const service = new DraftLockService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    changeSetFind.mockResolvedValue(null);
  });

  it('allows a new draft when nothing is open', async () => {
    await expect(service.assertNoOpenDraft()).resolves.toBeUndefined();
  });

  it('blocks a new draft while a change set is open', async () => {
    changeSetFind.mockResolvedValue({ id: 9 });
    await expect(service.assertNoOpenDraft()).rejects.toBeInstanceOf(ConflictException);
  });

  it('names the open draft so the caller can point the officer at it', async () => {
    changeSetFind.mockResolvedValue({ id: 9 });
    await expect(service.openDraft()).resolves.toEqual({ kind: 'changeset', id: 9 });
  });
});
