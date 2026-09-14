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
    return Buffer.from('PK-buyer');
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
  describe('buildBuyerBundle (D51)', () => {
    it('packs the receipt, the certificate and a README — and no secret.json', async () => {
      const { service, entries } = build();
      const property = makeProperty({ propertyId: '1001', ownerCommitment: '777' });

      const { zip } = await service.buildBuyerBundle(
        { property, merkleProof: merkleProof() },
        context,
        new Date('2026-09-14T03:00:00.000Z'),
      );

      // The buyer's secret was generated at the counter and never reached the
      // backend; there is nothing to put in a secret.json, and a placeholder
      // one would be worse than none.
      expect(entries().map((entry) => entry.name)).toEqual([
        'receipt.json',
        'certificate.pdf',
        'README.txt',
      ]);
      expect(zip).toEqual(Buffer.from('PK-buyer'));
    });

    it('describes the plot under its new owner at the given root', async () => {
      const { service, entries } = build();
      const property = makeProperty({ propertyId: '1001', ownerCommitment: '777' });

      const { receipt } = await service.buildBuyerBundle(
        { property, merkleProof: merkleProof() },
        context,
        new Date('2026-09-14T03:00:00.000Z'),
      );

      expect(receipt).toMatchObject({
        propertyId: '1001',
        rootVersion: 9,
        merkleRoot: '555',
        leaf: '5',
        transactionHash: '0xfeed',
        // The moment the transfer was published, in UTC+7 (D10).
        issuedOn: '2026-09-14T10:00:00+07:00',
      });
      expect(receipt.record.ownerCommitment).toBe('777');
      expect(JSON.parse(String(entries()[0].content))).toEqual(receipt);
      expect(Object.keys(receipt)).not.toContain('ownerSecret');
    });

    it('tells the buyer to pair it with the secret.json handed over at the counter', async () => {
      const { service, entries } = build();

      await service.buildBuyerBundle(
        { property: makeProperty({ propertyId: '1001' }), merkleProof: merkleProof() },
        context,
        new Date('2026-09-14T03:00:00.000Z'),
      );

      const readme = String(entries()[2].content);
      expect(readme).toMatch(/secret\.json/);
      expect(readme).toMatch(/quầy/);
    });
  });

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
