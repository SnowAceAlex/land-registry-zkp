import { OpenDraftService } from './open-draft.service';

describe('OpenDraftService (D53)', () => {
  const issuanceDetail = {
    kind: 'issuance' as const,
    id: 7,
    newRoot: '555',
    createdAt: new Date('2026-09-14T02:00:00.000Z'),
    propertyIds: ['1001'],
  };
  const changeSetDetail = {
    kind: 'changeset' as const,
    id: 9,
    newRoot: '777',
    createdAt: new Date('2026-09-14T03:00:00.000Z'),
    transferIds: [1],
    revocationIds: [],
    revocationCalldata: { propertyIds: [], reasonCodes: [], detailHashes: [] },
    deferredRevocations: 0,
  };

  function build(open: { kind: 'issuance' | 'changeset'; id: number } | null) {
    const lock = { openDraft: jest.fn().mockResolvedValue(open) };
    const issuanceBatches = { draftDetail: jest.fn().mockResolvedValue(issuanceDetail) };
    const changeSets = { draftDetail: jest.fn().mockResolvedValue(changeSetDetail) };
    const service = new OpenDraftService(
      lock as never,
      issuanceBatches as never,
      changeSets as never,
    );
    return { service, issuanceBatches, changeSets };
  }

  it('reports no draft as { draft: null } rather than an empty body', async () => {
    const { service } = build(null);
    await expect(service.current()).resolves.toEqual({ draft: null });
  });

  it('returns the full issuance draft when one is open', async () => {
    const { service, issuanceBatches, changeSets } = build({ kind: 'issuance', id: 7 });

    await expect(service.current()).resolves.toEqual({ draft: issuanceDetail });
    expect(issuanceBatches.draftDetail).toHaveBeenCalledWith(7);
    expect(changeSets.draftDetail).not.toHaveBeenCalled();
  });

  it('returns the full change set draft, calldata included, when one is open', async () => {
    const { service, issuanceBatches, changeSets } = build({ kind: 'changeset', id: 9 });

    await expect(service.current()).resolves.toEqual({ draft: changeSetDetail });
    expect(changeSets.draftDetail).toHaveBeenCalledWith(9);
    expect(issuanceBatches.draftDetail).not.toHaveBeenCalled();
  });
});
