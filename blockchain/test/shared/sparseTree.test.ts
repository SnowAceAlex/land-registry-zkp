import { expect } from 'chai';

import { generateMockRecords } from '../../scripts/tools/generateMockData';
import { buildTree, hashRecord, TREE_DEPTH } from '../../shared/merkleTree';
import {
  NodeReader,
  applyLeafUpdates,
  nodeKey,
  overlayReader,
  proofFrom,
  readerFromTree,
  siblingCoordsFor,
} from '../../shared/sparseTree';
import { LURRecord } from '../../shared/types';

/**
 * Every occupied node of a tree, flattened to `${height}:${index}` -> hash.
 *
 * Comparing this — not just the root — is what makes these tests worth having.
 * Two trees can agree on the root while one of them has kept a node that should
 * have been deleted, and the only symptom is a table that grows forever.
 */
function flatten(tree: Awaited<ReturnType<typeof buildTree>>): Map<string, bigint> {
  const flat = new Map<string, bigint>();
  tree.levels.forEach((level, height) => {
    for (const [index, hash] of level) flat.set(nodeKey(height, index), hash);
  });
  return flat;
}

/** Apply an overlay to a flattened snapshot, the way the node table would. */
function applyTo(
  snapshot: Map<string, bigint>,
  overlay: { touched: Map<string, bigint>; removed: string[] },
): Map<string, bigint> {
  const applied = new Map(snapshot);
  for (const key of overlay.removed) applied.delete(key);
  for (const [key, hash] of overlay.touched) applied.set(key, hash);
  return applied;
}

function sortedEntries(map: Map<string, bigint>): [string, string][] {
  return [...map.entries()]
    .map(([key, hash]) => [key, hash.toString()] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

describe('sparseTree — incremental updates (D72)', () => {
  let records: LURRecord[];

  before(async () => {
    // Scattered ids, not contiguous: that is the real case (cadastral parcel
    // numbers) and the only one where a per-level parent-grouping mistake shows
    // up — with adjacent ids most leaves share a parent and hide the bug.
    const mock = await generateMockRecords(40);
    records = mock.records.map((record, i) => ({
      ...record,
      propertyId: BigInt(i * 977 + 5),
    }));
  });

  it('siblingCoordsFor returns one coord per level, bottom-up', () => {
    const coords = siblingCoordsFor(5);
    expect(coords).to.have.lengthOf(TREE_DEPTH);
    expect(coords[0]).to.deep.equal({ height: 0, index: 4 });
    expect(coords[1]).to.deep.equal({ height: 1, index: 3 });
  });

  it('changing one leaf gives the same root AND the same node set as a full rebuild', async () => {
    const before = await buildTree(records);

    const changed = { ...records[7], ownerCommitment: records[7].ownerCommitment + 1n };
    const after = await buildTree(records.map((r, i) => (i === 7 ? changed : r)));

    const overlay = await applyLeafUpdates(
      new Map([[Number(changed.propertyId), await hashRecord(changed)]]),
      readerFromTree(before),
    );

    expect(overlay.root).to.equal(after.root);
    expect(sortedEntries(applyTo(flatten(before), overlay))).to.deep.equal(
      sortedEntries(flatten(after)),
    );
  });

  it('removing a leaf (revocation) matches a rebuild without it, including deleted nodes', async () => {
    const before = await buildTree(records);
    const dropped = records[3];
    const after = await buildTree(records.filter((r) => r.propertyId !== dropped.propertyId));

    const overlay = await applyLeafUpdates(
      new Map([[Number(dropped.propertyId), null]]),
      readerFromTree(before),
    );

    expect(overlay.root).to.equal(after.root);
    expect(sortedEntries(applyTo(flatten(before), overlay))).to.deep.equal(
      sortedEntries(flatten(after)),
    );
  });

  it('batches k changes into one overlay identical to rebuilding with all of them', async () => {
    const before = await buildTree(records);

    const edits = new Map<number, bigint | null>();
    const next: LURRecord[] = [];
    for (const [i, record] of records.entries()) {
      if (i % 5 === 0) {
        edits.set(Number(record.propertyId), null); // revoked
        continue;
      }
      if (i % 5 === 1) {
        const moved = { ...record, ownerCommitment: record.ownerCommitment + 99n };
        edits.set(Number(record.propertyId), await hashRecord(moved)); // transferred
        next.push(moved);
        continue;
      }
      next.push(record);
    }
    const after = await buildTree(next);

    const overlay = await applyLeafUpdates(edits, readerFromTree(before));

    expect(overlay.root).to.equal(after.root);
    expect(sortedEntries(applyTo(flatten(before), overlay))).to.deep.equal(
      sortedEntries(flatten(after)),
    );
  });

  it('proofFrom reproduces the proof a full tree would generate', async () => {
    const tree = await buildTree(records);
    const target = records[11];

    const proof = await proofFrom(
      Number(target.propertyId),
      await hashRecord(target),
      readerFromTree(tree),
    );

    expect(proof.siblings).to.have.lengthOf(TREE_DEPTH);
    expect(proof.pathIndices).to.have.lengthOf(TREE_DEPTH);
    expect(proof.root).to.equal(tree.root);
  });

  it('overlayReader answers from the projection, so a proof can be taken before anything is written', async () => {
    const before = await buildTree(records);
    const moved = { ...records[2], ownerCommitment: records[2].ownerCommitment + 7n };
    const newLeaf = await hashRecord(moved);

    const overlay = await applyLeafUpdates(
      new Map([[Number(moved.propertyId), newLeaf]]),
      readerFromTree(before),
    );
    const projected = await proofFrom(
      Number(moved.propertyId),
      newLeaf,
      overlayReader(overlay, readerFromTree(before)),
    );

    expect(projected.root).to.equal(overlay.root);

    const after = await buildTree(records.map((r, i) => (i === 2 ? moved : r)));
    expect(projected.root).to.equal(after.root);
  });

  it('an empty update set leaves the root untouched', async () => {
    const tree = await buildTree(records);
    const overlay = await applyLeafUpdates(new Map(), readerFromTree(tree));

    expect(overlay.root).to.equal(tree.root);
    expect(overlay.touched.size).to.equal(0);
    expect(overlay.removed).to.have.lengthOf(0);
  });

  it('building from empty by inserting every leaf matches buildTree (bootstrap invariant)', async () => {
    const empty: NodeReader = async () => undefined;
    const updates = new Map<number, bigint | null>();
    for (const record of records) {
      updates.set(Number(record.propertyId), await hashRecord(record));
    }

    const overlay = await applyLeafUpdates(updates, empty);
    const rebuilt = await buildTree(records);

    expect(overlay.root).to.equal(rebuilt.root);
    expect(overlay.touched.size).to.equal(
      rebuilt.levels.reduce((total, level) => total + level.size, 0),
    );
    expect(overlay.removed).to.have.lengthOf(0);
  });

  it('emptying the tree removes every node and returns the empty root', async () => {
    const before = await buildTree(records);
    const empty = await buildTree([]);

    const overlay = await applyLeafUpdates(
      new Map(records.map((record) => [Number(record.propertyId), null])),
      readerFromTree(before),
    );

    expect(overlay.root).to.equal(empty.root);
    // Nothing may survive: a node left behind here is a node that answers
    // "occupied" for a subtree that is empty, which corrupts every later proof.
    expect(applyTo(flatten(before), overlay).size).to.equal(0);
    expect(overlay.touched.size).to.equal(0);
  });
});
