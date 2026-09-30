import { describe, expect, it } from 'vitest';

import { ReceiptFileError, assertReceiptMatchesProof, parseReceiptFile } from './receipt-file';

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    propertyId: '42',
    record: { propertyId: '42' },
    issuer: {
      ethereumAccount: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      ethereumAccountSignature: 'c2lnbmF0dXJl',
      IssuerCertificateChain: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----',
    },
    ...overrides,
  };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ReceiptFileError ? error.code : 'not-a-receipt-error';
  }
  return undefined;
}

describe('parseReceiptFile', () => {
  it('accepts an issued receipt', () => {
    const parsed = parseReceiptFile(JSON.stringify(receipt()));

    expect(parsed.propertyId).toBe('42');
    expect(parsed.issuer.ethereumAccount).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  it('rejects text that is not JSON', () => {
    expect(codeOf(() => parseReceiptFile('{nope'))).toBe('invalid-json');
  });

  // A proof.json dropped into the receipt slot is the likely mistake.
  it('rejects a proof.json given as the receipt', () => {
    const proof = { proof: {}, publicSignals: ['1', '2', '3', '4'] };

    expect(codeOf(() => parseReceiptFile(JSON.stringify(proof)))).toBe('invalid-shape');
  });

  it('rejects a receipt without its issuer block', () => {
    expect(codeOf(() => parseReceiptFile(JSON.stringify(receipt({ issuer: undefined }))))).toBe(
      'invalid-shape',
    );
  });

  it('rejects an issuer block with an empty certificate', () => {
    const issuer = { ...receipt().issuer, IssuerCertificateChain: '' };

    expect(codeOf(() => parseReceiptFile(JSON.stringify(receipt({ issuer }))))).toBe(
      'invalid-shape',
    );
  });
});

describe('assertReceiptMatchesProof', () => {
  const parsed = parseReceiptFile(JSON.stringify(receipt()));

  it('passes when the proof is about the same plot', () => {
    // ownership: merkleRoot, propertyId, ownerCommitment, currentTimestamp
    expect(codeOf(() => assertReceiptMatchesProof(parsed, 'ownership', ['9', '42', '7', '1']))).toBe(
      undefined,
    );
  });

  it('reads propertyId at the transfer circuit index', () => {
    // transfer: oldMerkleRoot, newMerkleRoot, propertyId, …
    const signals = ['9', '8', '42', '7', '6', '5', '1'];

    expect(codeOf(() => assertReceiptMatchesProof(parsed, 'transfer', signals))).toBe(undefined);
  });

  it('rejects a receipt of another plot', () => {
    expect(codeOf(() => assertReceiptMatchesProof(parsed, 'ownership', ['9', '43', '7', '1']))).toBe(
      'property-mismatch',
    );
  });

  it('rejects a receipt whose propertyId is not a number', () => {
    const odd = parseReceiptFile(JSON.stringify(receipt({ propertyId: 'abc' })));

    expect(codeOf(() => assertReceiptMatchesProof(odd, 'ownership', ['9', '42', '7', '1']))).toBe(
      'property-mismatch',
    );
  });
});
