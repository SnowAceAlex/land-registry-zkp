import { expect } from 'chai';

import { generateMockRecords } from '../../scripts/tools/generateMockData';
import {
  TREE_DEPTH,
  buildTree,
  generateMerkleProof,
  getMerkleRoot,
  verifyMerkleProof,
} from '../../shared/merkleTree';

describe('merkleTree (Phase 1)', () => {
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
});
