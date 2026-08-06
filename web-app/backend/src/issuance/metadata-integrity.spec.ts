import { hashRecord, hashOffchainMetadata } from '@land-registry/blockchain/shared';

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

    // A cached Merkle proof and root version are refreshed on every publish;
    // including them would make each publish invalidate the bundles it just
    // issued.
    expect(await leafFor({ rootVersion: 99, merkleProof: { siblings: [] } })).toBe(baseline);
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
});
