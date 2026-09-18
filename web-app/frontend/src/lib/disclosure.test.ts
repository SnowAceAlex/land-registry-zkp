import { describe, expect, it } from 'vitest';

import { disclosureFor } from './disclosure';

const signals = (n: number) => Array.from({ length: n }, (_, i) => String(1000 + i));

describe('disclosureFor (D21/D67)', () => {
  it('discloses exactly the four ownership signals, in order', () => {
    const { disclosed } = disclosureFor('ownership', signals(4));

    expect(disclosed.map((s) => s.name)).toEqual([
      'merkleRoot',
      'propertyId',
      'ownerCommitment',
      'currentTimestamp',
    ]);
    expect(disclosed.map((s) => s.value)).toEqual(signals(4));
  });

  it('adds the threshold, and only the threshold, for mortgage', () => {
    const ownership = disclosureFor('ownership', signals(4)).disclosed.map((s) => s.name);
    const mortgage = disclosureFor('mortgage', signals(5)).disclosed.map((s) => s.name);

    expect(mortgage.filter((name) => !ownership.includes(name))).toEqual([
      'minRequiredRemainingTerm',
    ]);
  });

  it('names the old root for a transfer, which is what the contract compares', () => {
    const names = disclosureFor('transfer', signals(7)).disclosed.map((s) => s.name);

    expect(names).toContain('oldMerkleRoot');
    expect(names).toContain('newMerkleRoot');
    expect(names[0]).toBe('oldMerkleRoot');
  });

  /**
   * The claim mortgage.circom exists to make. It proves "clean title, at least
   * N years left" while revealing NEITHER the encumbrance status NOR the real
   * expiry date — the browser twin of the assertion ownerSmoke.ts makes.
   */
  it('withholds validityPeriod and encumbranceStatus from both owner proofs', () => {
    for (const circuit of ['ownership', 'mortgage'] as const) {
      const { withheld } = disclosureFor(circuit, signals(circuit === 'ownership' ? 4 : 5));

      expect(withheld).toContain('validityPeriod');
      expect(withheld).toContain('encumbranceStatus');
      expect(withheld).toContain('ownerSecret');
    }
  });

  it('lists the certificate details by what they are, not as a hash name', () => {
    const { withheld } = disclosureFor('ownership', signals(4));

    // `offchainHash` is a leaf field, but that name means nothing to a reader:
    // what is actually hidden is the address, area and land-use code it commits to.
    expect(withheld).toContain('offchainMetadata');
    expect(withheld).not.toContain('offchainHash');
  });

  it('never lists a signal as both disclosed and withheld', () => {
    for (const [circuit, count] of [
      ['ownership', 4],
      ['mortgage', 5],
      ['transfer', 7],
    ] as const) {
      const { disclosed, withheld } = disclosureFor(circuit, signals(count));
      const names = new Set(disclosed.map((s) => s.name));

      expect(withheld.filter((name) => names.has(name))).toEqual([]);
    }
  });

  // propertyId and ownerCommitment ARE disclosed, so they must not appear in
  // the withheld list even though they are leaf fields.
  it('does not claim to withhold a leaf field the circuit publishes', () => {
    const { withheld } = disclosureFor('ownership', signals(4));

    expect(withheld).not.toContain('propertyId');
    expect(withheld).not.toContain('ownerCommitment');
  });

  it('refuses a signal count that does not match the circuit', () => {
    expect(() => disclosureFor('ownership', signals(5))).toThrow(/4 public signals, got 5/);
    expect(() => disclosureFor('transfer', signals(4))).toThrow(/7 public signals, got 4/);
  });
});
