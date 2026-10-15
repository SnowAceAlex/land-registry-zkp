import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';

import { RoundArchiveService } from './round-archive.service';
import { BRANCH_ACTOR, CENTRAL_ACTOR } from '../../test/factories';

describe('RoundArchiveService (D88)', () => {
  const future = () => new Date(Date.now() + 60_000);
  const past = () => new Date(Date.now() - 1000);
  const publishedAt = new Date('2026-10-15T03:00:00Z');

  const row = (over: Record<string, unknown> = {}) => ({
    id: 70,
    changeSetId: 12,
    officeId: 9,
    office: { code: 'CN01', name: 'Branch CN01' },
    changeSet: { rootVersion: 4, publishedAt },
    propertyCount: 3,
    expiresAt: future(),
    firstDownloadedAt: null,
    firstDownloadedByOfficeId: null,
    ...over,
  });

  function setup() {
    const prisma = {
      changeSet: { findUnique: jest.fn().mockResolvedValue({ id: 12 }) },
      changeSetArchive: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      landOffice: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, code: 'HQ' },
          { id: 9, code: 'CN01' },
          { id: 10, code: 'CN02' },
        ]),
      },
    };
    return { prisma, service: new RoundArchiveService(prisma as never) };
  }

  describe('archivesOf', () => {
    it('404s on an unknown change set', async () => {
      const { service, prisma } = setup();
      prisma.changeSet.findUnique.mockResolvedValue(null);

      await expect(service.archivesOf(99, CENTRAL_ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists every office archive for the central office, without the zip bytes', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findMany.mockResolvedValue([
        row(),
        row({ id: 71, officeId: 10, office: { code: 'CN02', name: 'Branch CN02' } }),
      ]);

      const result = await service.archivesOf(12, CENTRAL_ACTOR);

      expect(result.map((r) => r.officeCode)).toEqual(['CN01', 'CN02']);
      const args = prisma.changeSetArchive.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ changeSetId: 12 });
      expect(args.select).not.toHaveProperty('zip');
      expect(result[0]).toEqual({
        changeSetId: 12,
        rootVersion: 4,
        publishedAt,
        officeCode: 'CN01',
        officeName: 'Branch CN01',
        propertyCount: 3,
        expiresAt: expect.any(Date),
        expired: false,
        firstDownloadedAt: null,
        firstDownloadedByOfficeCode: null,
      });
    });

    it('shows a branch only its own office', async () => {
      const { service, prisma } = setup();

      await service.archivesOf(12, BRANCH_ACTOR);

      expect(prisma.changeSetArchive.findMany.mock.calls[0][0].where).toEqual({
        changeSetId: 12,
        officeId: BRANCH_ACTOR.officeId,
      });
    });

    it('marks an archive past its expiry and names who downloaded it first', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findMany.mockResolvedValue([
        row({
          expiresAt: past(),
          firstDownloadedAt: new Date('2026-10-16T01:00:00Z'),
          firstDownloadedByOfficeId: 1,
        }),
      ]);

      const [summary] = await service.archivesOf(12, CENTRAL_ACTOR);

      expect(summary).toMatchObject({
        expired: true,
        firstDownloadedAt: new Date('2026-10-16T01:00:00Z'),
        firstDownloadedByOfficeCode: 'HQ',
      });
    });
  });

  describe('archivesForActor', () => {
    it('lists all rounds, newest first, for the central office', async () => {
      const { service, prisma } = setup();

      await service.archivesForActor(CENTRAL_ACTOR);

      const args = prisma.changeSetArchive.findMany.mock.calls[0][0];
      expect(args.where).toEqual({});
      expect(args.orderBy).toEqual([{ changeSetId: 'desc' }, { office: { code: 'asc' } }]);
      expect(args.select).not.toHaveProperty('zip');
    });

    it('lists only the branch own archives for a branch', async () => {
      const { service, prisma } = setup();

      await service.archivesForActor(BRANCH_ACTOR);

      expect(prisma.changeSetArchive.findMany.mock.calls[0][0].where).toEqual({
        officeId: BRANCH_ACTOR.officeId,
      });
    });

    it('purges every expired archive before it lists', async () => {
      const { service, prisma } = setup();

      await service.archivesForActor(BRANCH_ACTOR);

      // Every office's expired copy, not only the caller's: the purge is about secrets, not scope.
      expect(prisma.changeSetArchive.updateMany).toHaveBeenCalledWith({
        where: { expiresAt: { lte: expect.any(Date) }, zip: { not: null } },
        data: { zip: null },
      });
      expect(prisma.changeSetArchive.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.changeSetArchive.findMany.mock.invocationCallOrder[0],
      );
    });
  });

  describe('purgeExpired', () => {
    it('drops the zip of every archive whose expiry has passed, keeping the row', async () => {
      const { service, prisma } = setup();
      const now = new Date('2026-10-22T03:00:00Z');
      prisma.changeSetArchive.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.purgeExpired(now)).resolves.toBe(2);

      expect(prisma.changeSetArchive.updateMany).toHaveBeenCalledWith({
        where: { expiresAt: { lte: now }, zip: { not: null } },
        data: { zip: null },
      });
    });
  });

  describe('archiveFor', () => {
    const stored = (over: Record<string, unknown> = {}) => ({
      id: 70,
      zip: Buffer.from('PK'),
      expiresAt: future(),
      firstDownloadedAt: null,
      ...over,
    });

    it('refuses a branch another office archive with 403 OutsideOfficeArea, before any read', async () => {
      const { service, prisma } = setup();

      const attempt = service.archiveFor(12, 'CN02', BRANCH_ACTOR);

      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({
        response: { reason: 'OutsideOfficeArea', message: expect.any(String) },
      });
      expect(prisma.changeSetArchive.findFirst).not.toHaveBeenCalled();
    });

    it('lets a branch download its own', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findFirst.mockResolvedValue(stored());

      await expect(service.archiveFor(12, 'CN01', BRANCH_ACTOR)).resolves.toEqual({
        zip: Buffer.from('PK'),
        filename: 'round-12-CN01.zip',
      });
    });

    it('lets the central office download any office archive', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findFirst.mockResolvedValue(stored());

      await expect(service.archiveFor(12, 'CN02', CENTRAL_ACTOR)).resolves.toMatchObject({
        filename: 'round-12-CN02.zip',
      });
      expect(prisma.changeSetArchive.findFirst.mock.calls[0][0].where).toEqual({
        changeSetId: 12,
        office: { code: 'CN02' },
      });
    });

    it('404s when the office has no archive in that round', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findFirst.mockResolvedValue(null);

      await expect(service.archiveFor(12, 'CN01', CENTRAL_ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('410s and purges the zip once expired', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findFirst.mockResolvedValue(stored({ expiresAt: past() }));

      await expect(service.archiveFor(12, 'CN01', CENTRAL_ACTOR)).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(prisma.changeSetArchive.update).toHaveBeenCalledWith({
        where: { id: 70 },
        data: { zip: null },
      });
      expect(prisma.changeSetArchive.updateMany).not.toHaveBeenCalled();
    });

    it('stays 410 for an already purged archive without purging again', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findFirst.mockResolvedValue(stored({ zip: null, expiresAt: past() }));

      await expect(service.archiveFor(12, 'CN01', CENTRAL_ACTOR)).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(prisma.changeSetArchive.update).not.toHaveBeenCalled();
    });

    it('stamps the first download with who took it, only while still unstamped', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findFirst.mockResolvedValue(stored());

      await service.archiveFor(12, 'CN01', { ...CENTRAL_ACTOR, officeId: 1 });

      expect(prisma.changeSetArchive.updateMany).toHaveBeenCalledWith({
        where: { id: 70, firstDownloadedAt: null },
        data: { firstDownloadedAt: expect.any(Date), firstDownloadedByOfficeId: 1 },
      });
    });

    it('does not restamp a later download', async () => {
      const { service, prisma } = setup();
      prisma.changeSetArchive.findFirst.mockResolvedValue(
        stored({ firstDownloadedAt: new Date('2026-10-16T01:00:00Z') }),
      );

      await service.archiveFor(12, 'CN01', BRANCH_ACTOR);

      expect(prisma.changeSetArchive.updateMany).not.toHaveBeenCalled();
    });
  });
});
