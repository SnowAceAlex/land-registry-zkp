/**
 * test/circuits/ownership.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ownership.circom — "I control this property and the title is still valid",
 * revealing nothing but propertyId, ownerCommitment and the timestamp.
 *
 * Covers CODING_ROADMAP §2.2 constraints 1–4, each with its failing branch, plus
 * an assertion that the public signals land in the exact order D21 pins (Phase 4's
 * LandRegistryVerifier.sol indexes them positionally, so the order is API).
 */

import { expect } from 'chai';
import * as path from 'path';
import wasm_tester, { WasmTester, Witness } from 'circom_tester/wasm/tester';
import { EncumbranceStatus, TenureType } from '../../shared/types';
import { buildOwnershipInput, PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import { makeSubject, SECONDS_PER_YEAR, OTHER_SECRET } from '../helpers/records';

const CIRCUIT_PATH = path.resolve(__dirname, '../../circuits/ownership.circom');
const INCLUDE_PATH = path.resolve(__dirname, '../../node_modules');

describe('circuits/ownership.circom (Phase 2)', () => {
  let circuit: WasmTester;
  let now: bigint;

  before(async () => {
    circuit = await wasm_tester(CIRCUIT_PATH, { include: INCLUDE_PATH });
    now = nowUnixTimestamp();
  });

  /** Run the witness calculator and assert it rejected the input. */
  async function expectRejected(input: Record<string, unknown>, why: string): Promise<void> {
    let threw = false;
    try {
      await circuit.calculateWitness(input);
    } catch {
      threw = true;
    }
    expect(threw, why).to.equal(true);
  }

  it('accepts a valid fixed-term title and exposes public signals in the D21 order', async () => {
    const subject = await makeSubject(now, { tenureType: TenureType.FIXED_TERM });
    const input = buildOwnershipInput({
      record: subject.record,
      ownerSecret: subject.secret,
      proof: subject.proof,
      currentTimestamp: now,
    });

    const witness: Witness = await circuit.calculateWitness(input);
    await circuit.checkConstraints(witness);

    // witness[0] is the constant 1; the public signals follow in declaration
    // order. This is exactly the array snarkjs hands to the Solidity verifier.
    const expected = [
      subject.tree.root,
      subject.record.propertyId,
      subject.record.ownerCommitment,
      now,
    ];
    expect(PUBLIC_SIGNAL_ORDER.ownership).to.have.lengthOf(expected.length);
    expected.forEach((value, i) => {
      expect(witness[i + 1], `publicSignals[${i}] = ${PUBLIC_SIGNAL_ORDER.ownership[i]}`).to.equal(
        value,
      );
    });
  });

  it('accepts a perpetual title whose validityPeriod is the 0 sentinel (D5/D23)', async () => {
    // Regression guard for the underflow in the §2.3 pseudocode: with a naive
    // `validityPeriod - currentTimestamp` this input is unprovable even though
    // the holder is perfectly legitimate.
    const subject = await makeSubject(now, { tenureType: TenureType.PERPETUAL });
    expect(subject.record.validityPeriod).to.equal(0n);

    const witness = await circuit.calculateWitness(
      buildOwnershipInput({
        record: subject.record,
        ownerSecret: subject.secret,
        proof: subject.proof,
        currentTimestamp: now,
      }),
    );
    await circuit.checkConstraints(witness);
  });

  it('accepts regardless of encumbrance — that is the mortgage circuit\'s job', async () => {
    const subject = await makeSubject(now, {
      encumbranceStatus: EncumbranceStatus.MORTGAGED,
    });
    const witness = await circuit.calculateWitness(
      buildOwnershipInput({
        record: subject.record,
        ownerSecret: subject.secret,
        proof: subject.proof,
        currentTimestamp: now,
      }),
    );
    await circuit.checkConstraints(witness);
  });

  it('rejects a wrong ownerSecret', async () => {
    const subject = await makeSubject(now);
    const input = buildOwnershipInput({
      record: subject.record,
      ownerSecret: OTHER_SECRET, // does not hash to record.ownerCommitment
      proof: subject.proof,
      currentTimestamp: now,
    });

    await expectRejected(input, 'ownerCommitment === Poseidon([ownerSecret]) must bind the owner');
  });

  it('rejects an expired fixed-term title', async () => {
    const subject = await makeSubject(now, {
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now - SECONDS_PER_YEAR, // expired a year ago
    });
    const input = buildOwnershipInput({
      record: subject.record,
      ownerSecret: subject.secret,
      proof: subject.proof,
      currentTimestamp: now,
    });

    await expectRejected(input, 'an expired title must not be provable');
  });

  it('rejects a title expiring exactly now (boundary: strictly greater than)', async () => {
    const subject = await makeSubject(now, {
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now,
    });
    const input = buildOwnershipInput({
      record: subject.record,
      ownerSecret: subject.secret,
      proof: subject.proof,
      currentTimestamp: now,
    });

    await expectRejected(input, 'validityPeriod must be strictly greater than currentTimestamp');
  });

  it('rejects a proof against the wrong merkleRoot', async () => {
    const subject = await makeSubject(now);
    const input = buildOwnershipInput({
      record: subject.record,
      ownerSecret: subject.secret,
      proof: subject.proof,
      currentTimestamp: now,
    });
    input.merkleRoot = (subject.tree.root + 1n).toString();

    await expectRejected(input, 'the computed root must equal the published root');
  });

  it('rejects a tampered Merkle sibling', async () => {
    const subject = await makeSubject(now);
    const input = buildOwnershipInput({
      record: subject.record,
      ownerSecret: subject.secret,
      proof: subject.proof,
      currentTimestamp: now,
    });
    const siblings = input.siblings as string[];
    siblings[0] = (BigInt(siblings[0]) + 1n).toString();

    await expectRejected(input, 'a forged Merkle path must not reach the published root');
  });
});
