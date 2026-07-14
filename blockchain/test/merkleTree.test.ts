import { expect } from 'chai';

import { generateMockRecords } from '../scripts/generateMockData';
import {
  TREE_DEPTH,
  buildTree,
  generateMerkleProof,
  getMerkleRoot,
  verifyMerkleProof,
} from '../shared/merkleTree';

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
});
