import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseBundleEntries } from '@/lib/bundle';

import { buyerSecretArchive, generateOwnerSecret, ownerSecretFile } from './buyer-secret';

/** BN254 scalar field modulus — every circuit signal must stay below it. */
const BN254 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe('generateOwnerSecret (D51)', () => {
  it('draws exactly 31 random bytes, like the backend issuance secrets', () => {
    let requested = 0;
    const secret = generateOwnerSecret((bytes) => {
      requested = bytes.length;
      bytes.fill(0xff);
      return bytes;
    });

    expect(requested).toBe(31);
    // 31 bytes of 0xff is the largest value it can produce: 2^248 − 1 < modulus.
    expect(secret).toBe((1n << 248n) - 1n);
    expect(secret < BN254).toBe(true);
  });

  it('reads the bytes big-endian', () => {
    const secret = generateOwnerSecret((bytes) => {
      bytes.fill(0);
      bytes[30] = 0x2a;
      return bytes;
    });

    expect(secret).toBe(42n);
  });

  it('uses the platform CSPRNG by default', () => {
    expect(generateOwnerSecret()).not.toBe(generateOwnerSecret());
  });
});

describe('ownerSecretFile', () => {
  it('writes the secret.json shape every reader expects (D31)', () => {
    expect(ownerSecretFile('1001', 42n)).toEqual({ propertyId: '1001', ownerSecret: '42' });
  });
});

describe('buyerSecretArchive (D51)', () => {
  it('packs secret.json inside the plot folder under a name the browser will not rename', () => {
    const { bytes, filename } = buyerSecretArchive('1001', 42n);

    expect(filename).toBe('secret-1001-buyer.zip');
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(['1001/secret.json']);
    expect(JSON.parse(strFromU8(files['1001/secret.json']))).toEqual({
      propertyId: '1001',
      ownerSecret: '42',
    });
  });

  it('pairs with the receipt the buyer downloads after publication', () => {
    const { bytes } = buyerSecretArchive('1001', 42n);
    const secretEntries = Object.entries(unzipSync(bytes)).map(([name, data]) => ({
      name,
      text: strFromU8(data),
    }));
    const receipt = {
      propertyId: '1001',
      leaf: '1',
      record: { ownerCommitment: '2' },
      merkleProof: { siblings: [] },
    };

    const bundle = parseBundleEntries([
      { name: 'receipt.json', text: JSON.stringify(receipt) },
      ...secretEntries,
    ]);

    expect(bundle.secret.ownerSecret).toBe('42');
  });
});
