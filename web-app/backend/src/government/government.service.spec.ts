import { BadRequestException } from '@nestjs/common';

import { makeProperty } from '../../test/factories';
import { GovernmentService, parsePropertyStatus } from './government.service';

describe('GovernmentService', () => {
  describe('listProperties — status filter (Phase 8)', () => {
    function build() {
      const findMany = jest.fn().mockResolvedValue([makeProperty({ status: 'IMPORTED' })]);
      const count = jest.fn().mockResolvedValue(1);
      const prisma = {
        property: { findMany, count },
        $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      } as never;
      return { service: new GovernmentService(prisma, {} as never), findMany, count };
    }

    it('filters the page AND the total by the same status', async () => {
      const { service, findMany, count } = build();

      const result = await service.listProperties({}, 'IMPORTED');

      // A total counted over every status would tell the issuance screen there
      // are more pages of IMPORTED plots than actually exist.
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'IMPORTED' } }),
      );
      expect(count).toHaveBeenCalledWith({ where: { status: 'IMPORTED' } });
      expect(result.total).toBe(1);
    });

    it('lists every status when none is given', async () => {
      const { service, findMany, count } = build();

      await service.listProperties({});

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
      expect(count).toHaveBeenCalledWith({ where: {} });
    });
  });

  describe('parsePropertyStatus', () => {
    it('accepts each stored status', () => {
      expect(parsePropertyStatus('IMPORTED')).toBe('IMPORTED');
      expect(parsePropertyStatus('ISSUED')).toBe('ISSUED');
      expect(parsePropertyStatus('REVOKED')).toBe('REVOKED');
    });

    it('treats an absent or empty query value as no filter', () => {
      expect(parsePropertyStatus(undefined)).toBeUndefined();
      expect(parsePropertyStatus('')).toBeUndefined();
    });

    it('400s on anything else instead of silently returning every row', () => {
      expect(() => parsePropertyStatus('issued')).toThrow(BadRequestException);
      expect(() => parsePropertyStatus('PENDING')).toThrow(/IMPORTED, ISSUED, REVOKED/);
    });
  });

  describe('registryStatus — chain identity for the portal (D54)', () => {
    it('reports the chainId of the deployment the backend reads', async () => {
      const chain = {
        network: 'localhost',
        chainId: 31337,
        rootRegistryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        authorityAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        getLatestRoot: jest.fn().mockResolvedValue(555n),
        getRootVersion: jest.fn().mockResolvedValue(3),
      };
      const prisma = {
        merkleRoot: {
          findFirst: jest.fn().mockResolvedValue({ root: '555', version: 3, txHash: '0xabc' }),
        },
      } as never;

      const status = await new GovernmentService(prisma, chain as never).registryStatus();

      expect(status).toEqual(
        expect.objectContaining({
          network: 'localhost',
          chainId: 31337,
          contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          inSync: true,
        }),
      );
    });
  });
});
