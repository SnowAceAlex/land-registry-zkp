import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { BundleError, parseBundleEntries, readBundleFiles } from './bundle';

const receipt = (propertyId = '1001') => ({
  issuedOn: '2026-09-14T10:00:00+07:00',
  transactionHash: '0xfeed',
  contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  rootVersion: 3,
  merkleRoot: '555',
  propertyId,
  leaf: '123',
  merkleProof: { siblings: Array(20).fill('0'), pathIndices: Array(20).fill(0) },
  record: { propertyId, ownerCommitment: '777' },
  issuer: {
    ethereumAccount: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    ethereumAccountSignature: 'c2ln',
    IssuerCertificateChain: '-----BEGIN CERTIFICATE-----',
  },
});
const secret = (propertyId = '1001') => ({ propertyId, ownerSecret: '424242' });

const json = (value: unknown) => JSON.stringify(value);

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof BundleError ? error.code : 'not-a-bundle-error';
  }
  return undefined;
}

describe('parseBundleEntries', () => {
  it('pairs a receipt with its secret', () => {
    const bundle = parseBundleEntries([
      { name: 'receipt.json', text: json(receipt()) },
      { name: 'secret.json', text: json(secret()) },
    ]);

    expect(bundle.receipt.propertyId).toBe('1001');
    expect(bundle.secret.ownerSecret).toBe('424242');
  });

  it('finds the files inside the per-plot folder of the issuance archive (D42)', () => {
    const bundle = parseBundleEntries([
      { name: '1001/receipt.json', text: json(receipt()) },
      { name: '1001/secret.json', text: json(secret()) },
      { name: '1001/README.txt', text: 'readme' },
    ]);

    expect(bundle.receipt.propertyId).toBe('1001');
  });

  it('refuses a whole batch archive instead of guessing which plot the officer meant', () => {
    expect(
      codeOf(() =>
        parseBundleEntries([
          { name: '1001/receipt.json', text: json(receipt('1001')) },
          { name: '1001/secret.json', text: json(secret('1001')) },
          { name: '1002/receipt.json', text: json(receipt('1002')) },
          { name: '1002/secret.json', text: json(secret('1002')) },
        ]),
      ),
    ).toBe('multiple-properties');
  });

  it('names the missing half', () => {
    expect(codeOf(() => parseBundleEntries([{ name: 'secret.json', text: json(secret()) }]))).toBe(
      'missing-receipt',
    );
    expect(
      codeOf(() => parseBundleEntries([{ name: 'receipt.json', text: json(receipt()) }])),
    ).toBe('missing-secret');
  });

  it('rejects a secret that belongs to a different plot', () => {
    expect(
      codeOf(() =>
        parseBundleEntries([
          { name: 'receipt.json', text: json(receipt('1001')) },
          { name: 'secret.json', text: json(secret('1002')) },
        ]),
      ),
    ).toBe('property-mismatch');
  });

  it('distinguishes unreadable JSON from JSON of the wrong shape', () => {
    expect(
      codeOf(() =>
        parseBundleEntries([
          { name: 'receipt.json', text: '{ not json' },
          { name: 'secret.json', text: json(secret()) },
        ]),
      ),
    ).toBe('invalid-json');
    expect(
      codeOf(() =>
        parseBundleEntries([
          { name: 'receipt.json', text: json({ propertyId: '1001' }) },
          { name: 'secret.json', text: json(secret()) },
        ]),
      ),
    ).toBe('invalid-shape');
    expect(
      codeOf(() =>
        parseBundleEntries([
          { name: 'receipt.json', text: json(receipt()) },
          { name: 'secret.json', text: json({ propertyId: '1001', ownerSecret: 'abc' }) },
        ]),
      ),
    ).toBe('invalid-shape');
  });
});

describe('readBundleFiles', () => {
  it('reads a per-plot ZIP', async () => {
    const zip = zipSync({
      '1001/receipt.json': strToU8(json(receipt())),
      '1001/secret.json': strToU8(json(secret())),
      '1001/certificate.pdf': new Uint8Array([37, 80, 68, 70]),
    });

    const bundle = await readBundleFiles([new File([zip], 'bundle-1001.zip')]);

    expect(bundle.secret.propertyId).toBe('1001');
  });

  it('reads the two JSON files selected together', async () => {
    const bundle = await readBundleFiles([
      new File([json(receipt())], 'receipt.json', { type: 'application/json' }),
      new File([json(secret())], 'secret.json', { type: 'application/json' }),
    ]);

    expect(bundle.receipt.leaf).toBe('123');
  });

  it('reports an empty selection', async () => {
    await expect(readBundleFiles([])).rejects.toMatchObject({ code: 'no-files' });
  });
});
