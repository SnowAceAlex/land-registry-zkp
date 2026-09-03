import { buildTree } from '@land-registry/blockchain/shared';
import { sortByPropertyId } from './tree.service';
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
