import { OpenDraftService } from './open-draft.service';

describe('OpenDraftService (D53)', () => {
  const changeSetDetail = {
    kind: 'changeset' as const,
    id: 9,
    newRoot: '777',
    createdAt: new Date('2026-09-14T03:00:00.000Z'),
    issuanceRequestIds: [],
    transferIds: [1],
    revocationIds: [],
    revocationCalldata: { propertyIds: [], reasonCodes: [], detailHashes: [] },
    deferredRevocations: 0,
  };

  function build(open: { kind: 'changeset'; id: number } | null) {
    const lock = { openDraft: jest.fn().mockResolvedValue(open) };
    const changeSets = { draftDetail: jest.fn().mockResolvedValue(changeSetDetail) };
    const service = new OpenDraftService(lock as never, changeSets as never);
    return { service, changeSets };
  }

  it('reports no draft as { draft: null } rather than an empty body', async () => {
    const { service, changeSets } = build(null);
    await expect(service.current()).resolves.toEqual({ draft: null });
    expect(changeSets.draftDetail).not.toHaveBeenCalled();
  });

  it('returns the full change set draft, calldata included, when one is open', async () => {
    const { service, changeSets } = build({ kind: 'changeset', id: 9 });

    await expect(service.current()).resolves.toEqual({ draft: changeSetDetail });
    expect(changeSets.draftDetail).toHaveBeenCalledWith(9);
  });
});
