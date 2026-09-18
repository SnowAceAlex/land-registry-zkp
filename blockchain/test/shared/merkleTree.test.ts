import { expect } from 'chai';

import { generateMockRecords } from '../../scripts/tools/generateMockData';
import {
  LEAF_FIELD_ORDER,
  MAX_PROPERTY_ID,
  TREE_DEPTH,
  buildTree,
  generateMerkleProof,
  getMerkleRoot,
  hashRecord,
  poseidonHash,
  verifyMerkleProof,
} from '../../shared/merkleTree';

/** Read pathIndices (LSB-first, as the circuit does) back into a leaf index. */
function indexFromPathIndices(pathIndices: number[]): bigint {
  let acc = 0n;
  for (let i = pathIndices.length - 1; i >= 0; i--) {
    acc = acc * 2n + BigInt(pathIndices[i]);
  }
  return acc;
}

describe('merkleTree (Phase 1)', () => {
  // D67: hashRecord maps over LEAF_FIELD_ORDER, so the array IS the D4 order.
  // These two tests restate that order literally — a reorder of the array is
  // then a test failure here, not a silently different tree. The circuit-side
  // copy (leafHasher.circom) is guarded separately by test/circuits/*.
  describe('LEAF_FIELD_ORDER (D4/D67)', () => {
    it('is the 7 leaf fields in the order the circuits hash them', () => {
      expect([...LEAF_FIELD_ORDER]).to.deep.equal([
        'propertyId',
        'ownerCommitment',
        'useType',
        'validityPeriod',
        'encumbranceStatus',
        'tenureType',
        'offchainHash',
      ]);
    });

    it('is the order hashRecord actually hashes in', async () => {
      const { records } = await generateMockRecords(1);
      const record = records[0];

      expect(await hashRecord(record)).to.equal(
        await poseidonHash([
          record.propertyId,
          record.ownerCommitment,
          BigInt(record.useType),
          record.validityPeriod,
          BigInt(record.encumbranceStatus),
          BigInt(record.tenureType),
          record.offchainHash,
        ]),
      );
    });
  });

  it('builds a tree and produces a non-zero root', async () => {
    const { records } = await generateMockRecords(20);
    const tree = await buildTree(records);
    const root = await getMerkleRoot(tree);

    expect(root).to.be.a('bigint');
    expect(root).to.not.equal(0n);
  });

  it('generates a proof that verifies against the tree root', async () => {
    const { records } = await generateMockRecords(20);
    const tree = await buildTree(records);
    const target = records[7];

    const proof = await generateMerkleProof(tree, target);

    expect(proof.siblings).to.have.lengthOf(TREE_DEPTH);
    expect(proof.pathIndices).to.have.lengthOf(TREE_DEPTH);
    expect(await verifyMerkleProof(proof, tree.root)).to.equal(true);
  });

  it('rejects a proof tampered with a wrong sibling', async () => {
    const { records } = await generateMockRecords(20);
    const tree = await buildTree(records);
    const proof = await generateMerkleProof(tree, records[3]);

    const tampered = { ...proof, siblings: [...proof.siblings] };
    tampered.siblings[0] = tampered.siblings[0] + 1n;

    expect(await verifyMerkleProof(tampered, tree.root)).to.equal(false);
  });

  it('rejects a valid proof checked against the wrong root', async () => {
    const { records } = await generateMockRecords(20);
    const tree = await buildTree(records);
    const proof = await generateMerkleProof(tree, records[0]);

    expect(await verifyMerkleProof(proof, tree.root + 1n)).to.equal(false);
  });

  it('produces a stable root across repeated builds of the same records', async () => {
    const { records } = await generateMockRecords(15);

    const treeA = await buildTree(records);
    const treeB = await buildTree(records);

    expect(treeA.root).to.equal(treeB.root);
  });

  it('produces a valid full-depth proof even for a single-record tree', async () => {
    const { records } = await generateMockRecords(1);
    const tree = await buildTree(records);
    const proof = await generateMerkleProof(tree, records[0]);

    expect(proof.siblings).to.have.lengthOf(TREE_DEPTH);
    expect(await verifyMerkleProof(proof, tree.root)).to.equal(true);
  });

  it('fails fast when records contain a duplicate propertyId', async () => {
    const { records } = await generateMockRecords(3);
    records[2] = { ...records[2], propertyId: records[0].propertyId };

    let threw = false;
    try {
      await buildTree(records);
    } catch (e) {
      threw = true;
      expect((e as Error).message).to.match(/duplicate propertyId/);
    }
    expect(threw).to.equal(true);
  });

  it('rejects a record whose fields drifted from the tree leaf', async () => {
    const { records } = await generateMockRecords(5);
    const tree = await buildTree(records);
    // Same propertyId (so lookup succeeds) but a mutated field -> different leaf.
    const drifted = { ...records[1], validityPeriod: records[1].validityPeriod + 1n };

    let threw = false;
    try {
      await generateMerkleProof(tree, drifted);
    } catch (e) {
      threw = true;
      expect((e as Error).message).to.match(/does not match tree leaf/);
    }
    expect(threw).to.equal(true);
  });

  it('rejects a proof with a malformed pathIndices entry', async () => {
    const { records } = await generateMockRecords(4);
    const tree = await buildTree(records);
    const proof = await generateMerkleProof(tree, records[0]);

    const malformed = { ...proof, pathIndices: [...proof.pathIndices] };
    malformed.pathIndices[0] = 2; // not 0 or 1

    expect(await verifyMerkleProof(malformed, tree.root)).to.equal(false);
  });

  it('places each leaf at index = propertyId (D41)', async () => {
    const { records } = await generateMockRecords(12);
    const tree = await buildTree(records);

    for (const record of records) {
      const proof = await generateMerkleProof(tree, record);
      expect(indexFromPathIndices(proof.pathIndices)).to.equal(record.propertyId);
    }
  });

  it('produces the same root regardless of input order (D41 supersedes D24)', async () => {
    const { records } = await generateMockRecords(10);
    const reversed = [...records].reverse();

    const inOrder = await buildTree(records);
    const shuffled = await buildTree(reversed);

    expect(shuffled.root).to.equal(inOrder.root);
  });

  it('rejects a propertyId outside the addressable range (D41)', async () => {
    const { records } = await generateMockRecords(2);
    records[1] = { ...records[1], propertyId: MAX_PROPERTY_ID + 1n };

    let threw = false;
    try {
      await buildTree(records);
    } catch (e) {
      threw = true;
      expect((e as Error).message).to.match(/outside the addressable range/);
    }
    expect(threw).to.equal(true);
  });
});
