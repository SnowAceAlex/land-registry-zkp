import * as crypto from 'crypto';
import { ethers } from 'ethers';

import { readOrganizationName } from '@land-registry/blockchain/shared';

import { IssuerService } from './issuer.service';
import { ChainService } from '../chain/chain.service';

const ORG_NAME = 'So Tai nguyen va Moi truong TP.HCM';
const ACCOUNT = '0xc128Eb26F177BB6a3b4374A715be350887ED7726';

/**
 * Generates a throwaway certificate with the subject shape
 * scripts/generate-issuer-cert.ts produces, so the test exercises real RSA
 * signing rather than a stub. Self-signed here: what this spec covers is the
 * address signature and the issuer block, not the D78 root chain (that is
 * `issuer-chain.test.ts` in the frontend). Uses openssl, which the cert script
 * requires too.
 */
function makeTestCertificate(): { keyPem: string; certPem: string } {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issuer-spec-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');

  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-sha256',
      '-subj',
      `/C=VN/O=${ORG_NAME}/CN=test-issuer`,
    ],
    { stdio: 'ignore' },
  );

  return {
    keyPem: fs.readFileSync(keyPath, 'utf8'),
    certPem: fs.readFileSync(certPath, 'utf8'),
  };
}

describe('IssuerService (D30/D31)', () => {
  let service: IssuerService;
  let certPem: string;

  beforeAll(async () => {
    const generated = makeTestCertificate();
    certPem = generated.certPem;

    const chain = {
      authorityAddress: ACCOUNT,
      getAuthorityInstitute: jest
        .fn()
        .mockResolvedValue(ethers.keccak256(ethers.toUtf8Bytes(ORG_NAME))),
    } as unknown as ChainService;

    service = new IssuerService(chain);
    process.env.ISSUER_KEY_PATH = writeTemp(generated.keyPem, 'key.pem');
    process.env.ISSUER_CERT_PATH = writeTemp(generated.certPem, 'cert.pem');
    await service.onModuleInit();
  });

  afterAll(() => {
    delete process.env.ISSUER_KEY_PATH;
    delete process.env.ISSUER_CERT_PATH;
  });

  it('reads the organization name out of the certificate Subject', () => {
    expect(service.orgName).toBe(ORG_NAME);
    expect(readOrganizationName(certPem)).toBe(ORG_NAME);
  });

  it('signs the Ethereum account so the certificate public key verifies it', () => {
    const signature = service.signEthereumAccount(ACCOUNT);
    const publicKey = new crypto.X509Certificate(certPem).publicKey;

    const verified = crypto.verify(
      'sha256',
      Buffer.from(ACCOUNT, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );

    expect(verified).toBe(true);
  });

  it('signs over the EIP-55 form, so a lowercase address yields the same signature', () => {
    expect(service.signEthereumAccount(ACCOUNT.toLowerCase())).toBe(
      service.signEthereumAccount(ACCOUNT),
    );
  });

  it('produces a signature that does not verify for a different address', () => {
    const signature = service.signEthereumAccount(ACCOUNT);
    const publicKey = new crypto.X509Certificate(certPem).publicKey;
    const otherAccount = ethers.getAddress('0x1111111111111111111111111111111111111111');

    const verified = crypto.verify(
      'sha256',
      Buffer.from(otherAccount, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );

    expect(verified).toBe(false);
  });

  it('builds the receipt issuer block with the [SmartCert] field names', () => {
    const block = service.buildIssuerBlock();

    expect(Object.keys(block).sort()).toEqual([
      'IssuerCertificateChain',
      'ethereumAccount',
      'ethereumAccountSignature',
    ]);
    expect(block.ethereumAccount).toBe(ACCOUNT);
    expect(block.IssuerCertificateChain).toContain('BEGIN CERTIFICATE');
  });

  it('hashes the organization name the way the contract anchor stores it', () => {
    // Cross-checks the D30 anchor formula against the deployed Sepolia value.
    expect(ethers.keccak256(ethers.toUtf8Bytes(ORG_NAME))).toBe(
      '0x1f730914c2418f93d7466bfc23ec84f2790208f8c887355a7acaa798fa0ba603',
    );
  });
});

function writeTemp(contents: string, name: string): string {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'issuer-pem-')), name);
  fs.writeFileSync(file, contents);
  return file;
}
