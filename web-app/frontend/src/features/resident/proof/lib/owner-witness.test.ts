import {
  buildMortgageInput,
  buildOwnershipInput,
  type MerkleProofData,
} from '@land-registry/blockchain/shared';
import { describe, expect, it } from 'vitest';

import { OWNER_SECRET, sampleBundle } from './__fixtures__/bundle';
import { buildOwnerProofInput, proofFileName } from './owner-witness';

const TIMESTAMP = 1_800_000_000n;

async function subject() {
  const { record, refreshed } = await sampleBundle();
  const proof: MerkleProofData = {
    leaf: BigInt(refreshed.leaf),
    siblings: refreshed.siblings.map((s) => BigInt(s)),
    pathIndices: refreshed.pathIndices,
    root: BigInt(refreshed.merkleRoot),
  };
  return { record, refreshed, proof };
}

describe('buildOwnerProofInput (UC-5)', () => {
  /**
   * Asserted by calling the shared builders directly rather than by listing
   * field names, so D25 holds for the TEST too: no circuit signal name is
   * spelled anywhere in this file. A renamed signal moves both sides at once.
   */
  it('produces exactly what buildOwnershipInput produces', async () => {
    const { record, refreshed, proof } = await subject();

    expect(
      buildOwnerProofInput('ownership', {
        record,
        ownerSecret: OWNER_SECRET,
        refreshed,
        currentTimestamp: TIMESTAMP,
      }),
    ).toEqual(
      buildOwnershipInput({ record, ownerSecret: OWNER_SECRET, proof, currentTimestamp: TIMESTAMP }),
    );
  });

  it('produces exactly what buildMortgageInput produces, with the years converted', async () => {
    const { record, refreshed, proof } = await subject();

    expect(
      buildOwnerProofInput('mortgage', {
        record,
        ownerSecret: OWNER_SECRET,
        refreshed,
        currentTimestamp: TIMESTAMP,
        minRemainingTermYears: 5,
      }),
    ).toEqual(
      buildMortgageInput({
        record,
        ownerSecret: OWNER_SECRET,
        proof,
        currentTimestamp: TIMESTAMP,
        minRequiredRemainingTerm: 5n * 365n * 24n * 3600n,
      }),
    );
  });

  it('gives the mortgage witness exactly one signal the ownership witness lacks', async () => {
    const { record, refreshed } = await subject();
    const common = { record, ownerSecret: OWNER_SECRET, refreshed, currentTimestamp: TIMESTAMP };

    const ownership = buildOwnerProofInput('ownership', common);
    const mortgage = buildOwnerProofInput('mortgage', { ...common, minRemainingTermYears: 5 });

    const extra = Object.keys(mortgage).filter((key) => !(key in ownership));
    expect(extra).toHaveLength(1);
    expect(Object.keys(ownership).filter((key) => !(key in mortgage))).toEqual([]);
  });

  // The refreshed path, not the receipt's: a receipt predating someone else's
  // publish carries a path that no longer reaches the current root.
  it('takes the Merkle path from the refreshed response', async () => {
    const { record, refreshed } = await subject();
    const moved = {
      ...refreshed,
      merkleRoot: '12345',
      siblings: refreshed.siblings.map((s) => (BigInt(s) + 1n).toString()),
    };

    const input = buildOwnerProofInput('ownership', {
      record,
      ownerSecret: OWNER_SECRET,
      refreshed: moved,
      currentTimestamp: TIMESTAMP,
    });

    expect(JSON.stringify(input)).toContain('12345');
    expect(JSON.stringify(input)).not.toContain(refreshed.merkleRoot);
  });

  it('refuses a refreshed proof for a different plot', async () => {
    const { record, refreshed } = await subject();

    expect(() =>
      buildOwnerProofInput('ownership', {
        record,
        ownerSecret: OWNER_SECRET,
        refreshed: { ...refreshed, propertyId: '2002' },
        currentTimestamp: TIMESTAMP,
      }),
    ).toThrow(/2002/);
  });

  it('refuses a mortgage witness with no threshold', async () => {
    const { record, refreshed } = await subject();

    expect(() =>
      buildOwnerProofInput('mortgage', {
        record,
        ownerSecret: OWNER_SECRET,
        refreshed,
        currentTimestamp: TIMESTAMP,
      }),
    ).toThrow(/whole years/);
  });

  it('refuses a threshold that is not a whole, non-negative number of years', async () => {
    const { record, refreshed } = await subject();
    const common = {
      record,
      ownerSecret: OWNER_SECRET,
      refreshed,
      currentTimestamp: TIMESTAMP,
    };

    expect(() => buildOwnerProofInput('mortgage', { ...common, minRemainingTermYears: 1.5 })).toThrow();
    expect(() => buildOwnerProofInput('mortgage', { ...common, minRemainingTermYears: -1 })).toThrow();
  });
});

describe('proofFileName', () => {
  it('names the file after the claim and the plot', () => {
    expect(proofFileName('ownership', '1001')).toBe('proof-ownership-1001.json');
    expect(proofFileName('mortgage', '1001')).toBe('proof-mortgage-1001.json');
  });
});
