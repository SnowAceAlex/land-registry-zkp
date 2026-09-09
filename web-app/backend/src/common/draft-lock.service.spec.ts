import { ConflictException } from '@nestjs/common';

import { DraftLockService } from './draft-lock.service';

describe('DraftLockService (D44)', () => {
  const issuanceFind = jest.fn();
  const changeSetFind = jest.fn();
  const prisma = {
    issuanceBatch: { findFirst: issuanceFind },
    changeSet: { findFirst: changeSetFind },
  } as never;
  const service = new DraftLockService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    issuanceFind.mockResolvedValue(null);
    changeSetFind.mockResolvedValue(null);
  });

  it('allows a new draft when nothing is open', async () => {
    await expect(service.assertNoOpenDraft()).resolves.toBeUndefined();
  });

  it('blocks a new draft while an issuance batch is open', async () => {
    issuanceFind.mockResolvedValue({ id: 7 });
    await expect(service.assertNoOpenDraft()).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks a new draft while a change set is open — the lock spans both types', async () => {
    changeSetFind.mockResolvedValue({ id: 9 });
    await expect(service.assertNoOpenDraft()).rejects.toBeInstanceOf(ConflictException);
  });

  it('names the open draft so the caller can point the officer at it', async () => {
    changeSetFind.mockResolvedValue({ id: 9 });
    await expect(service.openDraft()).resolves.toEqual({ kind: 'changeset', id: 9 });
  });
});
