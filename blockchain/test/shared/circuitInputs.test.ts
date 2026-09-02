/**
 * test/shared/circuitInputs.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the public-signal lookups added in Phase 6 (D21/D25).
 *
 * These four functions are how every consumer outside this file reaches into a
 * `publicSignals` array — the backend verify endpoint, the transfer flow, and
 * the Phase 9 browser portal. The alternative is a literal index written at each
 * call site, which is D21 copied into places nothing keeps in step. So what is
 * really under test here is that the lookups stay tied to PUBLIC_SIGNAL_ORDER
 * rather than to numbers someone typed once.
 */

import { expect } from 'chai';

import {
  PUBLIC_SIGNAL_ORDER,
  circuitTypeForSignalCount,
  describePublicSignals,
  publicSignalIndex,
  rootSignalName,
} from '../../shared/circuitInputs';

describe('publicSignalIndex', () => {
  it('matches the index table in CODING_ROADMAP §2.5', () => {
    expect(publicSignalIndex('ownership', 'merkleRoot')).to.equal(0);
    expect(publicSignalIndex('ownership', 'currentTimestamp')).to.equal(3);
    expect(publicSignalIndex('mortgage', 'minRequiredRemainingTerm')).to.equal(4);
    expect(publicSignalIndex('transfer', 'newMerkleRoot')).to.equal(1);
    expect(publicSignalIndex('transfer', 'currentTimestamp')).to.equal(5);
  });

  it('throws for a signal the circuit does not have, naming the ones it does', () => {
    // ownership has no threshold — asking for one is a caller bug, and reading
    // undefined instead would produce a NaN comparison that silently passes.
    expect(() => publicSignalIndex('ownership', 'minRequiredRemainingTerm')).to.throw(
      /has no public signal 'minRequiredRemainingTerm'.*merkleRoot, propertyId/,
    );
  });
});

describe('rootSignalName', () => {
  it('names the root each circuit must be checked against', () => {
    expect(rootSignalName('ownership')).to.equal('merkleRoot');
    expect(rootSignalName('mortgage')).to.equal('merkleRoot');
    // transfer's newMerkleRoot is not published yet at verification time — that
    // asymmetry IS the two-step flow (D28), so verifying against it would be
    // checking the proof against a root the registry has never committed to.
    expect(rootSignalName('transfer')).to.equal('oldMerkleRoot');
  });

  it('always names a signal the circuit actually declares', () => {
    for (const circuit of ['ownership', 'mortgage', 'transfer'] as const) {
      expect(() => publicSignalIndex(circuit, rootSignalName(circuit))).to.not.throw();
      expect(publicSignalIndex(circuit, rootSignalName(circuit))).to.equal(0);
    }
  });
});

describe('circuitTypeForSignalCount', () => {
  it('identifies each circuit by its signal count', () => {
    expect(circuitTypeForSignalCount(4)).to.equal('ownership');
    expect(circuitTypeForSignalCount(5)).to.equal('mortgage');
    expect(circuitTypeForSignalCount(7)).to.equal('transfer');
  });

  it('agrees with PUBLIC_SIGNAL_ORDER for every circuit', () => {
    // The property that makes inference safe at all: the counts are distinct.
    // If a future circuit collides, this fails rather than picking a winner.
    for (const [circuit, order] of Object.entries(PUBLIC_SIGNAL_ORDER)) {
      expect(circuitTypeForSignalCount(order.length)).to.equal(circuit);
    }
  });

  it('throws for a count no circuit produces, listing the valid ones', () => {
    expect(() => circuitTypeForSignalCount(6)).to.throw(
      /no circuit takes 6 public signals.*ownership=4, mortgage=5, transfer=7/,
    );
    expect(() => circuitTypeForSignalCount(0)).to.throw(/no circuit takes 0/);
  });
});

describe('describePublicSignals', () => {
  it('labels signals in declaration order (D21)', () => {
    expect(describePublicSignals('ownership', ['11', '1', '22', '1785312000'])).to.deep.equal({
      merkleRoot: '11',
      propertyId: '1',
      ownerCommitment: '22',
      currentTimestamp: '1785312000',
    });
  });

  it('discloses the mortgage threshold but nothing resembling an expiry date', () => {
    const disclosed = describePublicSignals('mortgage', [
      '11',
      '1',
      '22',
      '1785312000',
      '157680000',
    ]);

    // The whole point of D6/D16: the bank learns the threshold the owner chose
    // to clear, never the actual validityPeriod.
    expect(Object.keys(disclosed)).to.deep.equal([...PUBLIC_SIGNAL_ORDER.mortgage]);
    expect(disclosed).to.not.have.property('validityPeriod');
    expect(disclosed).to.not.have.property('encumbranceStatus');
  });

  it('rejects an array whose length does not match the circuit', () => {
    expect(() => describePublicSignals('ownership', ['11', '1', '22'])).to.throw(
      /has 4 public signals, got 3/,
    );
  });
});
