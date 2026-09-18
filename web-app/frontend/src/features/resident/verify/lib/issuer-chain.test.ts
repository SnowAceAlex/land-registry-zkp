import fs from 'node:fs';
import path from 'node:path';

import { getAddress, keccak256, toBytes } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  issuerSignaturePayload,
  loadX509,
  organizationHash,
  pemToDer,
} from './issuer-chain';

const CERT_PATH = path.resolve(
  import.meta.dirname,
  '../../../../../../../web-app/backend/certs/issuer.cert.pem',
);
const KEY_PATH = path.resolve(
  import.meta.dirname,
  '../../../../../../../web-app/backend/certs/issuer.key.pem',
);
const certsPresent = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('pemToDer / base64ToBytes', () => {
  it('decodes a PEM body to the bytes it encodes', () => {
    const der = pemToDer('-----BEGIN CERTIFICATE-----\nAAEC\n-----END CERTIFICATE-----\n');
    expect([...der]).toEqual([0, 1, 2]);
  });

  it('ignores line breaks inside the body', () => {
    const der = pemToDer('-----BEGIN CERTIFICATE-----\nAA\nEC\n-----END CERTIFICATE-----');
    expect([...der]).toEqual([0, 1, 2]);
  });

  it('takes the first certificate of a chain', () => {
    const pem =
      '-----BEGIN CERTIFICATE-----\nAAEC\n-----END CERTIFICATE-----\n' +
      '-----BEGIN CERTIFICATE-----\nAwQF\n-----END CERTIFICATE-----\n';
    expect([...pemToDer(pem)]).toEqual([0, 1, 2]);
  });

  it('refuses something that is not a PEM certificate', () => {
    expect(() => pemToDer('not a certificate')).toThrow(/PEM/);
  });

  it('round-trips through base64ToBytes', () => {
    expect([...base64ToBytes('AAEC')]).toEqual([0, 1, 2]);
    expect([...base64ToBytes('')]).toEqual([]);
  });
});

/**
 * D34e: the signed message is the UTF-8 bytes of the EIP-55 CHECKSUMMED
 * address. The same address written in lowercase is a different byte string and
 * would verify against nothing — the exact trap issuerIdentity.ts warns about.
 */
describe('issuerSignaturePayload (D34e)', () => {
  it('is the UTF-8 bytes of the checksummed address', () => {
    expect(new TextDecoder().decode(issuerSignaturePayload(ACCOUNT))).toBe(ACCOUNT);
  });

  it('normalises a lowercase address to the checksummed form', () => {
    expect(issuerSignaturePayload(ACCOUNT.toLowerCase())).toEqual(issuerSignaturePayload(ACCOUNT));
  });

  it('differs from the bytes of the lowercase spelling', () => {
    const lower = new TextEncoder().encode(ACCOUNT.toLowerCase());
    expect([...issuerSignaturePayload(ACCOUNT)]).not.toEqual([...lower]);
  });
});

describe('organizationHash (D30 anchor)', () => {
  it('is keccak256 of the UTF-8 organization name', () => {
    const org = 'So Tai nguyen va Moi truong TP.HCM';
    expect(organizationHash(org)).toBe(keccak256(toBytes(org)));
  });

  it('is sensitive to any difference in the name', () => {
    expect(organizationHash('So Tai nguyen')).not.toBe(organizationHash('So Tai nguyen '));
  });
});

/**
 * The whole point of this suite: the browser half of D30 must reach the same
 * conclusion as the Node half in `blockchain/shared/issuerIdentity.ts`. Signs
 * with node:crypto exactly as `signIssuerAddress` does, then verifies with
 * @peculiar/x509 + WebCrypto exactly as the browser will.
 *
 * Self-skips on a checkout without `cert:generate` output.
 */
describe.skipIf(!certsPresent)('the browser and Node halves of D30 agree', () => {
  it('reads the same organization name node:crypto reads', async () => {
    const { X509Certificate } = await loadX509();
    const { readOrganizationName } = await import('@land-registry/blockchain/shared/issuerIdentity');

    const pem = fs.readFileSync(CERT_PATH, 'utf8');
    const [browserOrg] = new X509Certificate(pem).subjectName.getField('O');

    expect(browserOrg).toBe(readOrganizationName(pem));
  });

  it('verifies a signature that signIssuerAddress produced', async () => {
    const { X509Certificate } = await loadX509();
    const { signIssuerAddress } = await import('@land-registry/blockchain/shared/issuerIdentity');

    const signature = signIssuerAddress(fs.readFileSync(KEY_PATH, 'utf8'), getAddress(ACCOUNT));
    const certificate = new X509Certificate(fs.readFileSync(CERT_PATH, 'utf8'));
    const key = await certificate.publicKey.export({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, [
      'verify',
    ]);

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64ToBytes(signature),
      issuerSignaturePayload(ACCOUNT),
    );

    expect(valid).toBe(true);
  });

  it('rejects a signature over a different address', async () => {
    const { X509Certificate } = await loadX509();
    const { signIssuerAddress } = await import('@land-registry/blockchain/shared/issuerIdentity');

    const other = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    const signature = signIssuerAddress(fs.readFileSync(KEY_PATH, 'utf8'), other);
    const certificate = new X509Certificate(fs.readFileSync(CERT_PATH, 'utf8'));
    const key = await certificate.publicKey.export({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, [
      'verify',
    ]);

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64ToBytes(signature),
      issuerSignaturePayload(ACCOUNT),
    );

    expect(valid).toBe(false);
  });

  // The fact that makes link 1 `not-verifiable` rather than `pass`.
  it('confirms the PoC certificate really is self-signed', async () => {
    const { X509Certificate } = await loadX509();
    const certificate = new X509Certificate(fs.readFileSync(CERT_PATH, 'utf8'));

    expect(certificate.subject).toBe(certificate.issuer);
  });
});
