import { describe, expect, it } from 'vitest';

import {
  RETIRED_TREE_DEPTHS,
  TREE_DEPTH,
} from '@land-registry/blockchain/shared/treeDimensions';
import type { OwnerBundle } from '@/lib/bundle';

import { NEIGHBOUR_SECRET, sampleBundle } from './__fixtures__/bundle';
import { checkBundleIntegrity } from './bundle-integrity';

/** Deep-clone a bundle so a tampering test cannot leak into the next one. */
function clone(bundle: OwnerBundle): OwnerBundle {
  return JSON.parse(JSON.stringify(bundle)) as OwnerBundle;
}

describe('checkBundleIntegrity (UC-5)', () => {
  it('passes a genuine bundle and returns the rebuilt record', async () => {
    const { bundle } = await sampleBundle();
    const report = await checkBundleIntegrity(bundle);

    expect(report.issues).toEqual([]);
    expect(report.leaf.toString()).toBe(bundle.receipt.leaf);
    expect(report.record.propertyId).toBe(BigInt(bundle.receipt.propertyId));
  });

  /**
   * The D36 regression, and the reason the leaf is recomputed rather than read.
   * `area` is a descriptive field: it is printed on the certificate, never
   * stored on chain, and reaches the leaf only through `offchainHash`. Before
   * D36 it could be edited inside an issued receipt while the Merkle proof
   * still verified.
   */
  it('catches an edited certificate field, and reports only that', async () => {
    const { bundle } = await sampleBundle();
    const tampered = clone(bundle);
    tampered.receipt.record.area = 999.9;

    const report = await checkBundleIntegrity(tampered);

    expect(report.issues).toEqual(['leaf-mismatch']);
  });

  it('catches an edited address the same way', async () => {
    const { bundle } = await sampleBundle();
    const tampered = clone(bundle);
    tampered.receipt.record.address = 'Số 9999, Đường Khác, Phường Sài Gòn, TP.HCM';

    expect((await checkBundleIntegrity(tampered)).issues).toEqual(['leaf-mismatch']);
  });

  it('catches a secret.json that belongs to someone else', async () => {
    const { bundle } = await sampleBundle();
    const wrongSecret = clone(bundle);
    wrongSecret.secret.ownerSecret = NEIGHBOUR_SECRET.toString();

    expect((await checkBundleIntegrity(wrongSecret)).issues).toEqual(['secret-mismatch']);
  });

  it('catches a tampered sibling in the receipt path', async () => {
    const { bundle } = await sampleBundle();
    const tampered = clone(bundle);
    const siblings = tampered.receipt.merkleProof.siblings;
    siblings[0] = (BigInt(siblings[0]) + 1n).toString();

    expect((await checkBundleIntegrity(tampered)).issues).toEqual(['merkle-mismatch']);
  });

  /** Cut the receipt's path to `siblings` / `pathIndices` entries. */
  function truncatePath(bundle: OwnerBundle, siblings: number, pathIndices = siblings) {
    const cut = clone(bundle);
    cut.receipt.merkleProof.siblings = cut.receipt.merkleProof.siblings.slice(0, siblings);
    cut.receipt.merkleProof.pathIndices = cut.receipt.merkleProof.pathIndices.slice(0, pathIndices);
    return cut;
  }

  // A length this registry never issued at: damaged, or not ours.
  it('catches a path whose length this registry never issued', async () => {
    const { bundle } = await sampleBundle();

    expect((await checkBundleIntegrity(truncatePath(bundle, 19))).issues).toEqual([
      'depth-mismatch',
    ]);
  });

  /**
   * D75: every bundle issued before D71 carries a depth-20 path — including
   * the ones this registry issued itself. It used to be reported as "not
   * issued by this registry", i.e. forged.
   */
  it.each(RETIRED_TREE_DEPTHS)(
    'names a depth-%i path as an old bundle, not a foreign one',
    async (depth) => {
      const { bundle } = await sampleBundle();

      expect((await checkBundleIntegrity(truncatePath(bundle, depth))).issues).toEqual([
        'depth-retired',
      ]);
    },
  );

  it('does not call a path retired when its two arrays disagree', async () => {
    const { bundle } = await sampleBundle();

    expect((await checkBundleIntegrity(truncatePath(bundle, 20, 19))).issues).toEqual([
      'depth-mismatch',
    ]);
  });

  it('never lists the current depth as retired', () => {
    expect(RETIRED_TREE_DEPTHS).not.toContain(TREE_DEPTH);
  });

  it('catches a receipt whose header and record name different plots', async () => {
    const { bundle } = await sampleBundle();
    const mismatched = clone(bundle);
    mismatched.receipt.propertyId = '2002';

    expect((await checkBundleIntegrity(mismatched)).issues).toContain('property-mismatch');
  });

  it('reports every independent problem at once', async () => {
    const { bundle } = await sampleBundle();
    const broken = clone(bundle);
    broken.receipt.record.area = 999.9;
    broken.secret.ownerSecret = NEIGHBOUR_SECRET.toString();

    const report = await checkBundleIntegrity(broken);

    expect(report.issues).toContain('leaf-mismatch');
    expect(report.issues).toContain('secret-mismatch');
  });

  // The file being internally consistent says nothing about the tree being
  // current; that is asked separately, against latestRoot (D64).
  it('passes a bundle whose root is stale, because staleness is a different question', async () => {
    const { bundle } = await sampleBundle();
    const stale = clone(bundle);
    stale.receipt.rootVersion = 1;

    expect((await checkBundleIntegrity(stale)).issues).toEqual([]);
  });
});
