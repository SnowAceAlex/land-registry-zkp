/**
 * test/circuits/mortgage.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * mortgage.circom — clean-title + sufficient-remaining-term proof (D6).
 *
 * The privacy claim under test: the bank learns only "encumbrance-free, and at
 * least N seconds of term remain". The actual validityPeriod stays private, so
 * the same record proves the same threshold whether it expires in 10 or 40
 * years — covered by the two passing threshold cases below.
 */

import { expect } from 'chai';
import * as path from 'path';
import wasm_tester, { WasmTester } from 'circom_tester/wasm/tester';
import { EncumbranceStatus, TenureType } from '../../shared/types';
import { buildMortgageInput, PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import { makeSubject, SECONDS_PER_YEAR, OTHER_SECRET } from '../helpers/records';

const CIRCUIT_PATH = path.resolve(__dirname, '../../circuits/mortgage.circom');
const INCLUDE_PATH = path.resolve(__dirname, '../../node_modules');

describe('circuits/mortgage.circom (Phase 2)', () => {
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

  it('accepts a clean title with term to spare and exposes public signals in the D21 order', async () => {
    const minRequired = 5n * SECONDS_PER_YEAR;
    const subject = await makeSubject(now, {
      encumbranceStatus: EncumbranceStatus.FREE,
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now + 10n * SECONDS_PER_YEAR,
    });

    const witness = await circuit.calculateWitness(
      buildMortgageInput({
        record: subject.record,
        ownerSecret: subject.secret,
        proof: subject.proof,
        currentTimestamp: now,
        minRequiredRemainingTerm: minRequired,
      }),
    );
    await circuit.checkConstraints(witness);

    const expected = [
      subject.tree.root,
      subject.record.propertyId,
      subject.record.ownerCommitment,
      now,
      minRequired,
    ];
    expect(PUBLIC_SIGNAL_ORDER.mortgage).to.have.lengthOf(expected.length);
    expected.forEach((value, i) => {
      expect(witness[i + 1], `publicSignals[${i}] = ${PUBLIC_SIGNAL_ORDER.mortgage[i]}`).to.equal(
        value,
      );
    });

    // The private expiry date must not appear among the public signals — this is
    // the whole point of using a threshold proof instead of disclosing the date.
    const publicSignals = witness.slice(1, expected.length + 1);
    expect(publicSignals).to.not.include(subject.record.validityPeriod);
  });

  it('accepts a title sitting exactly on the threshold', async () => {
    const minRequired = 7n * SECONDS_PER_YEAR;
    const subject = await makeSubject(now, {
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now + minRequired, // remaining term == threshold
    });

    const witness = await circuit.calculateWitness(
      buildMortgageInput({
        record: subject.record,
        ownerSecret: subject.secret,
        proof: subject.proof,
        currentTimestamp: now,
        minRequiredRemainingTerm: minRequired,
      }),
    );
    await circuit.checkConstraints(witness);
  });

  it('accepts a perpetual title against any threshold (D5/D23)', async () => {
    const subject = await makeSubject(now, {
      tenureType: TenureType.PERPETUAL,
      encumbranceStatus: EncumbranceStatus.FREE,
    });
    expect(subject.record.validityPeriod).to.equal(0n);

    const witness = await circuit.calculateWitness(
      buildMortgageInput({
        record: subject.record,
        ownerSecret: subject.secret,
        proof: subject.proof,
        currentTimestamp: now,
        minRequiredRemainingTerm: 50n * SECONDS_PER_YEAR,
      }),
    );
    await circuit.checkConstraints(witness);
  });

  it('rejects a title one second short of the threshold', async () => {
    const minRequired = 7n * SECONDS_PER_YEAR;
    const subject = await makeSubject(now, {
      tenureType: TenureType.FIXED_TERM,
      validityPeriod: now + minRequired - 1n,
    });

    await expectRejected(
      buildMortgageInput({
        record: subject.record,
        ownerSecret: subject.secret,
        proof: subject.proof,
        currentTimestamp: now,
        minRequiredRemainingTerm: minRequired,
      }),
      'remaining term must be >= the claimed threshold',
    );
  });

  it('rejects a mortgaged title', async () => {
    const subject = await makeSubject(now, {
      encumbranceStatus: EncumbranceStatus.MORTGAGED,
    });

    await expectRejected(
      buildMortgageInput({
        record: subject.record,
        ownerSecret: subject.secret,
        proof: subject.proof,
        currentTimestamp: now,
        minRequiredRemainingTerm: SECONDS_PER_YEAR,
      }),
      'encumbranceStatus === FREE is a hard constraint (D7)',
    );
  });

  it('rejects a litigated title', async () => {
    const subject = await makeSubject(now, {
      encumbranceStatus: EncumbranceStatus.LITIGATED,
    });

    await expectRejected(
      buildMortgageInput({
        record: subject.record,
        ownerSecret: subject.secret,
        proof: subject.proof,
        currentTimestamp: now,
        minRequiredRemainingTerm: SECONDS_PER_YEAR,
      }),
      'only EncumbranceStatus.FREE may produce a clean-title proof',
    );
  });

  it('rejects a wrong ownerSecret', async () => {
    const subject = await makeSubject(now);

    await expectRejected(
      buildMortgageInput({
        record: subject.record,
        ownerSecret: OTHER_SECRET,
        proof: subject.proof,
        currentTimestamp: now,
        minRequiredRemainingTerm: SECONDS_PER_YEAR,
      }),
      'only the holder of ownerSecret may pledge the title',
    );
  });
});
