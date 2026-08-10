/**
 * test/circuits/merkleProof.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-layer test: the circom MerkleProof template must recompute exactly the
 * same root as the TypeScript sparse tree in shared/merkleTree.ts.
 *
 * This is the load-bearing test of Phase 2. The two layers are written
 * independently but must agree on the Poseidon leaf order (D4), the bottom-up
 * traversal, and the pathIndices left/right convention. If they drift, every
 * downstream proof still *generates* but never *verifies* — a failure mode
 * that is extremely hard to diagnose from Phase 8. Catch it here instead.
 */

import { expect } from 'chai';
import * as path from 'path';
import wasm_tester, { WasmTester } from 'circom_tester/wasm/tester';
import { MerkleProofData } from '../../shared/types';
import { buildTree, generateMerkleProof, TREE_DEPTH } from '../../shared/merkleTree';
import { generateMockRecords } from '../../scripts/tools/generateMockData';

const CIRCUIT_PATH = path.resolve(__dirname, '../../circuits/common/merkleProof.circom');
// circomlib resolves under blockchain/node_modules, NOT the workspace root.
const INCLUDE_PATH = path.resolve(__dirname, '../../node_modules');

/** MerkleProofData -> circom input object (circom wants decimal strings). */
function toCircuitInput(proof: MerkleProofData) {
  return {
    leaf: proof.leaf.toString(),
    pathIndices: proof.pathIndices.map((i) => i.toString()),
    siblings: proof.siblings.map((s) => s.toString()),
  };
}

describe('circuits/common/merkleProof.circom (Phase 2)', () => {
  let circuit: WasmTester;

  before(async () => {
    // The .circom file declares only a template, no `component main` —
    // circom_tester generates the main component for us, so we don't have to
    // commit a wrapper circuit that exists purely for tests.
    circuit = await wasm_tester(CIRCUIT_PATH, {
      include: INCLUDE_PATH,
      templateName: 'MerkleProof',
      templateParams: [TREE_DEPTH],
    });
  });

  it('recomputes the same root as shared/merkleTree.ts buildTree()', async () => {
    const { records } = await generateMockRecords(8);
    const tree = await buildTree(records);
    const proof = await generateMerkleProof(tree, records[3]);

    const witness = await circuit.calculateWitness(toCircuitInput(proof));
    await circuit.checkConstraints(witness);
    await circuit.assertOut(witness, { root: tree.root });
  });

  it('agrees with the TS layer for every leaf in the tree (both left and right children)', async () => {
    const { records } = await generateMockRecords(5);
    const tree = await buildTree(records);

    for (const record of records) {
      const proof = await generateMerkleProof(tree, record);
      const witness = await circuit.calculateWitness(toCircuitInput(proof));
      await circuit.assertOut(witness, { root: tree.root });
    }
  });

  it('handles a single-record tree (path is entirely zero-hashes)', async () => {
    const { records } = await generateMockRecords(1);
    const tree = await buildTree(records);
    const proof = await generateMerkleProof(tree, records[0]);

    expect(proof.siblings).to.have.lengthOf(TREE_DEPTH);
    const witness = await circuit.calculateWitness(toCircuitInput(proof));
    await circuit.assertOut(witness, { root: tree.root });
  });

  it('produces a different root when a sibling is tampered with', async () => {
    const { records } = await generateMockRecords(6);
    const tree = await buildTree(records);
    const proof = await generateMerkleProof(tree, records[2]);

    const tampered = toCircuitInput(proof);
    tampered.siblings[0] = (proof.siblings[0] + 1n).toString();

    const witness = await circuit.calculateWitness(tampered);
    // The circuit always computes *a* root; soundness comes from the caller
    // constraining it against the published root. Assert it no longer matches.
    const computedRoot = witness[1];
    expect(computedRoot).to.not.equal(tree.root);
  });

  it('rejects a non-binary pathIndex', async () => {
    const { records } = await generateMockRecords(4);
    const tree = await buildTree(records);
    const proof = await generateMerkleProof(tree, records[0]);

    const malformed = toCircuitInput(proof);
    malformed.pathIndices[0] = '2';

    let threw = false;
    try {
      await circuit.calculateWitness(malformed);
    } catch (error) {
      threw = true;
    }
    expect(threw, 'pathIndices[i] must be constrained to a bit').to.equal(true);
  });
});
