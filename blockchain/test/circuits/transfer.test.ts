/**
 * test/circuits/transfer.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * transfer.circom — proves an ownership change is legitimate against the old
 * root and the not-yet-published new root.
 *
 * The fixture mirrors what the government portal will actually do in Phase 5:
 * take the live record set, swap one record's ownerCommitment, rebuild the
 * tree. That means these tests also exercise the assumption transfer relies on —
 * that a rebuild keeps every other leaf where it was.
 */

import { expect } from 'chai';
import * as path from 'path';
import wasm_tester, { WasmTester } from 'circom_tester/wasm/tester';
import { EncumbranceStatus, LURRecord, MerkleProofData, TenureType } from '../../shared/types';
import {
  buildTree,
  generateMerkleProof,
  hashRecord,
  poseidonHash,
  LURMerkleTree,
} from '../../shared/merkleTree';
import { buildTransferInput, PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import {
  makeSubject,
  MakeRecordOptions,
  OTHER_SECRET,
  pathAt,
  SECONDS_PER_YEAR,
} from '../helpers/records';

const CIRCUIT_PATH = path.resolve(__dirname, '../../circuits/transfer.circom');
const INCLUDE_PATH = path.resolve(__dirname, '../../node_modules');

interface TransferFixture {
  oldRecord: LURRecord;
  newRecord: LURRecord;
  oldSecret: bigint;
  newSecret: bigint;
  oldTree: LURMerkleTree;
  newTree: LURMerkleTree;
  oldProof: MerkleProofData;
  newProof: MerkleProofData;
}

/** Build the before/after pair of trees for a transfer of one record. */
async function makeTransferFixture(
  now: bigint,
  options: MakeRecordOptions = {},
): Promise<TransferFixture> {
  const subject = await makeSubject(now, options);

  const newSecret = OTHER_SECRET;
  const newRecord: LURRecord = {
    ...subject.record,
    ownerCommitment: await poseidonHash([newSecret]),
  };

  // Rebuild the whole registry with the one record's owner swapped — order is
  // irrelevant under D41 — exactly the operation Phase 5's publish step performs.
  const newRecords = subject.allRecords.map((r) =>
    r.propertyId === subject.record.propertyId ? newRecord : r,
  );
  const newTree = await buildTree(newRecords);

  return {
    oldRecord: subject.record,
    newRecord,
    oldSecret: subject.secret,
    newSecret,
    oldTree: subject.tree,
    newTree,
    oldProof: subject.proof,
    newProof: await generateMerkleProof(newTree, newRecord),
  };
}

describe('circuits/transfer.circom (Phase 2)', () => {
  let circuit: WasmTester;
  let now: bigint;

  before(async () => {
    circuit = await wasm_tester(CIRCUIT_PATH, { include: INCLUDE_PATH });
    now = nowUnixTimestamp();
  });

  async function expectRejected(input: Record<string, unknown>, why: string): Promise<void> {
    let threw = false;
    try {
      await circuit.calculateWitness(input);
    } catch {
      threw = true;
    }
    expect(threw, why).to.equal(true);
  }

  function inputFor(fx: TransferFixture, minRequiredRemainingTerm = 0n) {
    return buildTransferInput({
      oldRecord: fx.oldRecord,
      newRecord: fx.newRecord,
      oldOwnerSecret: fx.oldSecret,
      newOwnerSecret: fx.newSecret,
      oldProof: fx.oldProof,
      newProof: fx.newProof,
      currentTimestamp: now,
      minRequiredRemainingTerm,
    });
  }

  it('accepts a clean transfer and exposes public signals in the D21 order', async () => {
    const minRequired = 5n * SECONDS_PER_YEAR;
    const fx = await makeTransferFixture(now, {
      encumbranceStatus: EncumbranceStatus.FREE,
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now + 10n * SECONDS_PER_YEAR,
    });
    expect(fx.oldTree.root, 'the swap must actually change the root').to.not.equal(fx.newTree.root);

    const witness = await circuit.calculateWitness(inputFor(fx, minRequired));
    await circuit.checkConstraints(witness);

    const expected = [
      fx.oldTree.root,
      fx.newTree.root,
      fx.oldRecord.propertyId,
      fx.oldRecord.ownerCommitment,
      fx.newRecord.ownerCommitment,
      now,
      minRequired,
    ];
    expect(PUBLIC_SIGNAL_ORDER.transfer).to.have.lengthOf(expected.length);
    expected.forEach((value, i) => {
      expect(witness[i + 1], `publicSignals[${i}] = ${PUBLIC_SIGNAL_ORDER.transfer[i]}`).to.equal(
        value,
      );
    });
  });

  it('rejects a transfer the seller did not authorise', async () => {
    const fx = await makeTransferFixture(now);
    const input = buildTransferInput({
      oldRecord: fx.oldRecord,
      newRecord: fx.newRecord,
      oldOwnerSecret: 42n, // not the preimage of oldOwnerCommitment
      newOwnerSecret: fx.newSecret,
      oldProof: fx.oldProof,
      newProof: fx.newProof,
      currentTimestamp: now,
      minRequiredRemainingTerm: 0n,
    });

    await expectRejected(input, 'the seller must prove knowledge of oldOwnerSecret');
  });

  it('rejects a transfer to a commitment the buyer cannot open', async () => {
    const fx = await makeTransferFixture(now);
    const input = buildTransferInput({
      oldRecord: fx.oldRecord,
      newRecord: fx.newRecord,
      oldOwnerSecret: fx.oldSecret,
      newOwnerSecret: 42n, // not the preimage of newOwnerCommitment
      oldProof: fx.oldProof,
      newProof: fx.newProof,
      currentTimestamp: now,
      minRequiredRemainingTerm: 0n,
    });

    await expectRejected(input, 'the buyer must prove knowledge of newOwnerSecret');
  });

  it('rejects transferring a mortgaged title', async () => {
    const fx = await makeTransferFixture(now, {
      encumbranceStatus: EncumbranceStatus.MORTGAGED,
    });

    await expectRejected(inputFor(fx), 'encumbered land must not be transferable');
  });

  it('rejects a newMerkleRoot that does not contain the new leaf', async () => {
    const fx = await makeTransferFixture(now);
    const input = inputFor(fx);
    input.newMerkleRoot = (fx.newTree.root + 1n).toString();

    await expectRejected(input, 'the new leaf must be included in the claimed new root');
  });

  it('rejects an oldMerkleRoot that does not contain the old leaf', async () => {
    const fx = await makeTransferFixture(now);
    const input = inputFor(fx);
    input.oldMerkleRoot = (fx.oldTree.root + 1n).toString();

    await expectRejected(input, 'the old leaf must be included in the published root');
  });

  it('accepts a perpetual title against any threshold (D5/D23)', async () => {
    const fx = await makeTransferFixture(now, { tenureType: TenureType.PERPETUAL });
    expect(fx.oldRecord.validityPeriod).to.equal(0n);

    const witness = await circuit.calculateWitness(inputFor(fx, 50n * SECONDS_PER_YEAR));
    await circuit.checkConstraints(witness);
  });

  it('rejects transferring an expired title even with a zero threshold (D27)', async () => {
    const fx = await makeTransferFixture(now, {
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now - SECONDS_PER_YEAR, // expired a year ago
    });

    await expectRejected(inputFor(fx, 0n), 'expired land must not change hands');
  });

  // Boundary semantics of the zero threshold, pinned deliberately (D27).
  //
  // `RemainingTermCheck` is a threshold primitive — "at least N seconds remain" —
  // so N = 0 means `validityPeriod >= currentTimestamp` and a title expiring at
  // exactly this instant still transfers. That is NOT an oversight, and it is not
  // in tension with ownership.circom, which asks for strictness by passing N = 1
  // at its own call site (see ownership.test.ts, same boundary, opposite verdict).
  //
  // Tightening N = 0 into `> currentTimestamp` would buy nothing: currentTimestamp
  // is prover-chosen and only checked to within PROOF_TIMESTAMP_TOLERANCE_SECONDS
  // (±600s), so the 1-second boundary sits inside a 600-second window anyway. It
  // would also make the public signal lie — a bank reading minRequiredRemainingTerm
  // would find 0 and 1 meaning the same thing.
  it('accepts a title expiring exactly now at a zero threshold (D27 boundary)', async () => {
    const fx = await makeTransferFixture(now, {
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now, // expires this very second
    });

    const witness = await circuit.calculateWitness(inputFor(fx, 0n));
    await circuit.checkConstraints(witness);
  });

  it('rejects a transfer claiming more remaining term than the title has', async () => {
    const fx = await makeTransferFixture(now, {
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now + 3n * SECONDS_PER_YEAR,
    });

    // The buyer is told they are acquiring at least 10 years; only ~3 remain.
    await expectRejected(
      inputFor(fx, 10n * SECONDS_PER_YEAR),
      'the acknowledged remaining term must actually be available',
    );
  });

  it('refuses to build an input that also edits a non-owner field', async () => {
    const fx = await makeTransferFixture(now);
    const tamperedNew: LURRecord = {
      ...fx.newRecord,
      validityPeriod: fx.newRecord.validityPeriod + 1000n,
    };

    // The circuit derives both leaves from one set of field signals, so this is
    // unprovable by construction. circuitInputs.ts turns it into a readable
    // error rather than an opaque witness-calculator assertion.
    let message = '';
    try {
      buildTransferInput({
        oldRecord: fx.oldRecord,
        newRecord: tamperedNew,
        oldOwnerSecret: fx.oldSecret,
        newOwnerSecret: fx.newSecret,
        oldProof: fx.oldProof,
        newProof: fx.newProof,
        currentTimestamp: now,
        minRequiredRemainingTerm: 0n,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).to.match(/only change ownerCommitment/);
  });

  it('rejects a transfer whose new leaf sits at a different slot (D41)', async () => {
    const fixture = await makeTransferFixture(now);
    const newLeaf = await hashRecord(fixture.newRecord);

    // A self-consistent path placing the new leaf one slot over, together with
    // the root that path implies — so newMerkle.root === newMerkleRoot still
    // holds and the ONLY unsatisfied constraint is the D41 index binding.
    // Shifting pathIndices alone would break the root check too, and the test
    // would then pass for the wrong reason.
    const misplaced = await pathAt(newLeaf, Number(fixture.newRecord.propertyId) + 1);

    const input = buildTransferInput({
      oldRecord: fixture.oldRecord,
      newRecord: fixture.newRecord,
      oldOwnerSecret: fixture.oldSecret,
      newOwnerSecret: fixture.newSecret,
      oldProof: fixture.oldProof,
      newProof: {
        leaf: newLeaf,
        siblings: misplaced.siblings,
        pathIndices: misplaced.pathIndices,
        root: misplaced.root,
      },
      currentTimestamp: now,
      minRequiredRemainingTerm: 0n,
    });

    let threw = false;
    try {
      await circuit.calculateWitness(input);
    } catch {
      threw = true;
    }
    expect(threw, 'both transfer paths must sit at index === propertyId').to.equal(true);
  });
});
