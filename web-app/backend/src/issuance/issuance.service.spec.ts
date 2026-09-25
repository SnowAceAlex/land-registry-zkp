import { MerkleProofData, TREE_DEPTH } from '@land-registry/blockchain/shared';

import { makeProperty } from '../../test/factories';
import { IssuanceService } from './issuance.service';
import { ZipEntry } from './zip.service';

const merkleProof = (): MerkleProofData => ({
  leaf: 5n,
  siblings: Array.from({ length: TREE_DEPTH }, (_, i) => BigInt(i + 1)),
  pathIndices: Array.from({ length: TREE_DEPTH }, () => 0),
  root: 555n,
});

const context = {
  rootVersion: 9,
  merkleRoot: 555n,
  transactionHash: '0xfeed',
  contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
};

function build() {
  const issuer = {
    buildIssuerBlock: jest.fn(() => ({
      ethereumAccount: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      ethereumAccountSignature: 'c2ln',
      IssuerCertificateChain: '-----BEGIN CERTIFICATE-----',
    })),
  };
  const pdf = { renderCertificate: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')) };
  const zipCreate = jest.fn(async (entries: ZipEntry[]) => {
    void entries;
    return Buffer.from('PK');
  });
  const service = new IssuanceService(
    issuer as never,
    pdf as never,
    { create: zipCreate } as never,
  );
  const entries = (): ZipEntry[] => zipCreate.mock.calls[0][0];
  return { service, zipCreate, entries, issuer };
}

describe('IssuanceService', () => {
  describe('buildBundleFiles — the owner bundle (D31)', () => {
    it('still carries receipt, secret, certificate and README, in that order', async () => {
      const { service, issuer } = build();

      const { files } = await service.buildBundleFiles(
        {
          property: makeProperty({ propertyId: '1001' }),
          ownerSecret: 42n,
          merkleProof: merkleProof(),
        },
        context,
        issuer.buildIssuerBlock(),
        '2026-09-14T10:00:00+07:00',
      );

      expect(files.map((file) => file.name)).toEqual([
        'receipt.json',
        'secret.json',
        'certificate.pdf',
        'README.txt',
      ]);
      expect(JSON.parse(String(files[1].content))).toEqual({
        propertyId: '1001',
        ownerSecret: '42',
      });
    });
  });
});
