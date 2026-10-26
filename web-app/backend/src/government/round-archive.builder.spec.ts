import { UnprocessableEntityException } from '@nestjs/common';

import { RoundArchiveBuilder } from './round-archive.builder';
import { makeProperty } from '../../test/factories';

describe('RoundArchiveBuilder (D88)', () => {
  const offices = new Map([
    [1, 'HQ'],
    [9, 'CN01'],
    [10, 'CN02'],
  ]);
  const publishedAt = new Date('2026-10-15T03:00:00Z');
  const overlay = { root: 555n, touched: new Map<string, bigint>(), removed: [] };

  const plot = (propertyId: string, landOfficeId: number | null) =>
    makeProperty({ propertyId, landOfficeId, ownerCommitment: 'old', leaf: 'old-leaf' });
  const plots = (a: number | null, b: number | null) =>
    new Map([
      ['6006', plot('6006', a)],
      ['1001', plot('1001', b)],
    ]);

  function setup() {
    const nodes = {
      proofInOverlay: jest
        .fn()
        .mockResolvedValue({ leaf: 1n, siblings: [], pathIndices: [], root: 555n }),
    };
    const chain = { rootRegistryAddress: '0xregistry', explorerTxUrlPrefix: undefined };
    const issuance = {
      batchContext: jest
        .fn()
        .mockReturnValue({ issuer: {}, issuedOn: '2026-10-15T10:00:00+07:00' }),
      buildBundleFiles: jest
        .fn()
        .mockResolvedValue({ files: [{ name: 'receipt.json', content: '{}' }] }),
    };
    const archive = {
      buildRound: jest.fn(async (input: { officeCode: string; entries: { kind: string }[] }) =>
        Buffer.from(`PK-${input.officeCode}`),
      ),
    };
    const builder = new RoundArchiveBuilder(
      nodes as never,
      chain as never,
      issuance as never,
      archive as never,
    );
    return { builder, nodes, issuance, archive };
  }

  const input = (over: Record<string, unknown> = {}) => ({
    changeSetId: 9,
    txHash: '0xfeed',
    rootVersion: 4,
    overlay,
    issuances: [{ propertyId: '6006', ownerCommitment: '888', ownerSecret: '77' }],
    transfers: [{ propertyId: '1001', newOwnerCommitment: '999', newOwnerSecret: '43' }],
    before: plots(9, 10),
    newLeaves: new Map([
      ['6006', '111'],
      ['1001', '222'],
    ]),
    publishedAt,
    offices,
    ...over,
  });

  it('groups the round by the plot land office, one archive each', async () => {
    const { builder, archive } = setup();

    const result = await builder.build(input());

    expect(result.map((r) => [r.officeId, r.officeCode, r.propertyCount])).toEqual([
      [9, 'CN01', 1],
      [10, 'CN02', 1],
    ]);
    expect(result[0].zip).toEqual(Buffer.from('PK-CN01'));
    expect(archive.buildRound).toHaveBeenCalledTimes(2);
    const cn01 = archive.buildRound.mock.calls.find((c) => c[0].officeCode === 'CN01')![0];
    expect(cn01).toMatchObject({ roundId: 9, rootVersion: 4, txHash: '0xfeed', publishedAt });
    expect(cn01.entries).toEqual([expect.objectContaining({ propertyId: '6006', kind: 'issued' })]);
  });

  it('puts several plots of one office into the same archive, issued before transferred', async () => {
    const { builder, archive } = setup();

    const result = await builder.build(input({ before: plots(9, 9) }));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ officeCode: 'CN01', propertyCount: 2 });
    const kinds = archive.buildRound.mock.calls[0][0].entries.map((e) => e.kind);
    expect(kinds).toEqual(['issued', 'transferred']);
  });

  it('sends a plot without a land office to the head office', async () => {
    const { builder } = setup();

    const result = await builder.build(input({ before: plots(null, 10) }));

    expect(result.map((r) => [r.officeId, r.officeCode])).toEqual([
      [1, 'HQ'],
      [10, 'CN02'],
    ]);
  });

  it('builds each bundle from the projected tree with the new commitment and secret', async () => {
    const { builder, nodes, issuance } = setup();

    await builder.build(input());

    const context = expect.objectContaining({
      rootVersion: 4,
      merkleRoot: 555n,
      transactionHash: '0xfeed',
    });

    // Calls follow the input order: issuances first, then transfers.
    // ISSUED plot: its own commitment (888), leaf (111) and secret (77).
    expect(nodes.proofInOverlay).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ propertyId: '6006', ownerCommitment: '888' }),
      111n,
      overlay,
    );
    expect(issuance.buildBundleFiles).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        property: expect.objectContaining({ propertyId: '6006', ownerCommitment: '888' }),
        ownerSecret: 77n,
      }),
      context,
      expect.anything(),
      expect.any(String),
    );

    // TRANSFERRED plot: the buyer's commitment (999), leaf (222) and secret (43).
    expect(nodes.proofInOverlay).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ propertyId: '1001', ownerCommitment: '999' }),
      222n,
      overlay,
    );
    expect(issuance.buildBundleFiles).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        property: expect.objectContaining({ propertyId: '1001', ownerCommitment: '999' }),
        ownerSecret: 43n,
      }),
      context,
      expect.anything(),
      expect.any(String),
    );
    expect(nodes.proofInOverlay).toHaveBeenCalledTimes(2);
  });

  it('builds nothing for a round without issuances or transfers', async () => {
    const { builder, archive } = setup();

    await expect(builder.build(input({ issuances: [], transfers: [] }))).resolves.toEqual([]);
    expect(archive.buildRound).not.toHaveBeenCalled();
  });

  it('refuses to guess when the head office is missing from the catalog', async () => {
    const { builder } = setup();

    await expect(
      builder.build(input({ offices: new Map([[9, 'CN01']]), before: plots(null, 9) })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
