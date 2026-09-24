import {
  TREE_DEPTH,
  hashOffchainMetadata,
  hashRecord,
  receiptOffchainMetadata,
  receiptToLURRecord,
} from '@land-registry/blockchain/shared';

import { buildReceipt } from './receipt.builder';
import { toLURRecord, toOffchainMetadata } from '../records/record.mapper';
import { makeProperty } from '../../test/factories';

/**
 * Regression guard for the integrity hole an external audit found (R2-01).
 *
 * Before `offchainHash` entered the leaf, the leaf covered only the six legal
 * fields. The descriptive fields — area, address, landUseCode, issuing
 * authority — were printed on the certificate and shipped inside receipt.json,
 * but nothing bound them to anything: an owner could edit their own receipt and
 * every check still passed, because the Merkle proof only ever spoke about the
 * leaf number.
 *
 * These tests assert the binding directly: change any covered field and the
 * leaf must move.
 */
describe('off-chain metadata is bound to the leaf (R2-01)', () => {
  async function leafFor(overrides: Parameters<typeof makeProperty>[0]) {
    return hashRecord(toLURRecord(makeProperty({ propertyId: '1001', ...overrides })));
  }

  it('covers every descriptive field the certificate prints', async () => {
    const baseline = await leafFor({});

    // Each of these was independently forgeable before the fix.
    const tampered = {
      area: makeProperty({ propertyId: '1001' }).area.mul(10),
      address: 'Số 999, Đường Nguyễn Huệ, Phường Sài Gòn, TP.HCM',
      landUseCode: 'CLN',
      certificateSerial: 'CT 999999',
      bookEntryNumber: 'CS-FORGED',
      issuingAuthority: 'Cơ quan bịa đặt',
      mapSheetNumber: '99',
      landOrigin: 'Nhà nước cho thuê đất trả tiền một lần',
    };

    for (const [field, value] of Object.entries(tampered)) {
      const leaf = await leafFor({ [field]: value } as Parameters<typeof makeProperty>[0]);
      expect(leaf).not.toBe(baseline);
    }
  });

  it('still moves the leaf when only the land user type changes', async () => {
    const baseline = await leafFor({});
    expect(await leafFor({ landUserType: 'CDS' })).not.toBe(baseline);
  });

  it('is stable for the same record — a rebuild must not change the leaf', async () => {
    // If the digest were unstable (key order, decimal formatting), every root
    // publish would silently invalidate every issued proof.
    expect(await leafFor({})).toBe(await leafFor({}));
  });

  it('does not depend on fields that change without re-issuing the certificate', async () => {
    const baseline = await leafFor({});

    // `leaf` and `rootVersion` are written on every publish that touches the
    // plot; including either in the digest would make a publish invalidate the
    // bundles it had just issued.
    expect(await leafFor({ rootVersion: 99, leaf: '12345' })).toBe(baseline);
  });

  it('distinguishes an absent optional field from an empty one', async () => {
    const absent = hashOffchainMetadata(
      toOffchainMetadata(makeProperty({ propertyId: '1001', mapSheetNumber: null })),
    );
    const empty = hashOffchainMetadata(
      toOffchainMetadata(makeProperty({ propertyId: '1001', mapSheetNumber: '' })),
    );
    expect(absent).not.toBe(empty);
  });

  /**
   * `buildReceipt` must write the row's values faithfully.
   *
   * The backend hashes a DB row; every reader of the issued bundle
   * (scripts/verifyReceipt.ts, the transfer smoke script, the Phase 9 browser
   * portal) hashes the `record` block those fields were written into. Both sides
   * now run the same field mapping, so they cannot disagree about WHICH fields
   * or HOW to normalise them — that class of drift is gone by construction, not
   * by this test.
   *
   * What is still only a convention, and what this test pins, is that the values
   * `buildReceipt` puts in `record` are the row's own. Types do not cover that:
   * an override added after the spread type-checks perfectly and produces a
   * receipt whose recomputed leaf is not in the tree — which reaches the owner
   * as "your proof is invalid" rather than as a bug report.
   */
  it('hashes the same bytes from a DB row and from the receipt built out of it', async () => {
    const property = makeProperty({ propertyId: '1001' });

    const receipt = buildReceipt({
      property,
      record: toLURRecord(property),
      merkleProof: {
        leaf: 1n,
        siblings: Array.from({ length: TREE_DEPTH }, () => 0n),
        pathIndices: Array.from({ length: TREE_DEPTH }, () => 0),
        root: 2n,
      },
      rootVersion: 1,
      merkleRoot: 2n,
      transactionHash: '0xabc',
      contractAddress: '0xdef',
      issuer: {
        ethereumAccount: '0x0000000000000000000000000000000000000001',
        ethereumAccountSignature: '',
        IssuerCertificateChain: '',
      },
      issuedOn: '2026-08-06T00:00:00+07:00',
    });

    expect(hashOffchainMetadata(receiptOffchainMetadata(receipt.record))).toBe(
      hashOffchainMetadata(toOffchainMetadata(property)),
    );

    // …and therefore the leaf a verifier recomputes from the receipt is the leaf
    // the registry put in the tree.
    expect(await hashRecord(receiptToLURRecord(receipt.record))).toBe(
      await hashRecord(toLURRecord(property)),
    );
  });
});
