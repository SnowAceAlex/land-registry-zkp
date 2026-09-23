import { buildTree } from '@land-registry/blockchain/shared';
import { sortByPropertyId, TreeService } from './tree.service';
import { toLURRecord } from '../records/record.mapper';
import { makeProperty } from '../../test/factories';

/**
 * `sortByPropertyId` no longer decides the tree (D41 keys leaf position to
 * propertyId), but it still decides the order of every property list the API
 * returns, so its numeric-vs-lexicographic behaviour is still worth pinning.
 * The final test is the regression guard for D41 itself.
 */
describe('leaf ordering (D41 supersedes D24)', () => {
  it('sorts propertyIds numerically, not lexicographically', () => {
    const rows = [
      makeProperty({ propertyId: '2' }),
      makeProperty({ propertyId: '10' }),
      makeProperty({ propertyId: '1' }),
      makeProperty({ propertyId: '100' }),
      makeProperty({ propertyId: '9' }),
    ];

    expect(sortByPropertyId(rows).map((r) => r.propertyId)).toEqual(['1', '2', '9', '10', '100']);
  });

  it('handles propertyIds far beyond Number.MAX_SAFE_INTEGER', () => {
    const big = '9007199254740993'; // 2^53 + 1 — loses precision as a Number
    const bigger = '9007199254740994';
    const rows = [makeProperty({ propertyId: bigger }), makeProperty({ propertyId: big })];

    expect(sortByPropertyId(rows).map((r) => r.propertyId)).toEqual([big, bigger]);
  });

  it('is stable: sorting an already-sorted list is a no-op', () => {
    const rows = ['1', '2', '10'].map((propertyId) => makeProperty({ propertyId }));
    expect(sortByPropertyId(sortByPropertyId(rows))).toEqual(sortByPropertyId(rows));
  });

  it('produces the same root every time for the same records', async () => {
    const rows = sortByPropertyId([
      makeProperty({ propertyId: '10' }),
      makeProperty({ propertyId: '2' }),
      makeProperty({ propertyId: '1' }),
    ]);

    const first = await buildTree(rows.map(toLURRecord));
    const second = await buildTree(rows.map(toLURRecord));

    expect(first.root).toBe(second.root);
  });

  it('produces the SAME root whatever the input order (D41 — position follows propertyId)', async () => {
    const rows = [
      makeProperty({ propertyId: '1' }),
      makeProperty({ propertyId: '2' }),
      makeProperty({ propertyId: '10' }),
    ];

    const numericOrder = await buildTree(sortByPropertyId(rows).map(toLURRecord));
    // What a Postgres `ORDER BY "propertyId"` on a String column would give.
    // Under D24 this produced a different tree; under D41 it cannot.
    const lexicographicOrder = await buildTree(
      [...rows].sort((a, b) => a.propertyId.localeCompare(b.propertyId)).map(toLURRecord),
    );

    expect(lexicographicOrder.root).toBe(numericOrder.root);
  });
});

describe('TreeService.loadIssuedProperties — membership rule (D45)', () => {
  it('excludes REVOKED properties from the tree (D45)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new TreeService({ property: { findMany } } as never);

    await service.loadIssuedProperties();

    expect(findMany).toHaveBeenCalledWith({ where: { status: 'ISSUED' } });
  });
});

describe('TreeService.streamIssuedProperties — paging rule (D72)', () => {
  it('pages by the autoincrement id, never by propertyId', async () => {
    const seen: Record<string, unknown>[] = [];
    const findMany = jest.fn(async (args: Record<string, unknown>) => {
      seen.push(args);
      return seen.length === 1 ? [makeProperty({ propertyId: '10' })] : [];
    });
    const service = new TreeService({ property: { findMany } } as never);

    for await (const batch of service.streamIssuedProperties(2)) {
      expect(batch).toHaveLength(1);
    }

    // `propertyId` is a String column, so Postgres orders it lexicographically
    // ("10" before "2") and paging by it would silently skip plots. Paging by
    // the autoincrement `id` is what makes the cursor total.
    expect(seen[0].orderBy).toEqual({ id: 'asc' });
    expect(seen[0].cursor).toBeUndefined();
    expect(seen[1].cursor).toEqual({ id: makeProperty({ propertyId: '10' }).id });
    expect(seen[1].skip).toBe(1);
  });

  it('still filters on ISSUED — the membership rule is the same one (D45)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new TreeService({ property: { findMany } } as never);

    for await (const _batch of service.streamIssuedProperties()) {
      // consume
    }

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ISSUED' } }),
    );
  });

  it('stops at the first empty batch instead of looping forever', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new TreeService({ property: { findMany } } as never);

    let batches = 0;
    for await (const _batch of service.streamIssuedProperties()) batches++;

    expect(batches).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
