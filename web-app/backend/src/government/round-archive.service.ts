import { ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';

import { Actor } from '../common/actor';
import { officeCodes } from '../common/office-codes';
import { roundArchiveFilename } from '../issuance/archive.service';
import { PrismaService } from '../prisma/prisma.service';
import { ArchiveSummaryDto } from './dto/archive.response.dto';

// Everything a summary needs; `zip` is deliberately absent.
const SUMMARY_SELECT = {
  changeSetId: true,
  officeId: true,
  office: { select: { code: true, name: true } },
  changeSet: { select: { rootVersion: true, publishedAt: true } },
  propertyCount: true,
  expiresAt: true,
  firstDownloadedAt: true,
  firstDownloadedByOfficeId: true,
} as const;

/** Listing and downloading a round's per-office archives (D88). */
@Injectable()
export class RoundArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async archivesOf(id: number, actor: Actor): Promise<ArchiveSummaryDto[]> {
    const round = await this.prisma.changeSet.findUnique({ where: { id }, select: { id: true } });
    if (!round) throw new NotFoundException(`Change set #${id} not found`);
    return this.summaries({ changeSetId: id, ...this.ownOffice(actor) });
  }

  async archivesForActor(actor: Actor): Promise<ArchiveSummaryDto[]> {
    return this.summaries(this.ownOffice(actor));
  }

  /** The office's archive of the round, while it exists. An expired archive is gone for good. */
  async archiveFor(
    id: number,
    officeCode: string,
    actor: Actor,
  ): Promise<{ zip: Buffer; filename: string }> {
    // D88: a branch downloads only its own archive — checked before any read.
    if (actor.scope === 'BRANCH' && officeCode !== actor.officeCode) {
      throw new ForbiddenException({
        reason: 'OutsideOfficeArea',
        message: `The archive of office ${officeCode} is outside the area of office ${actor.officeCode}`,
        details: { officeCode },
      });
    }

    const archive = await this.prisma.changeSetArchive.findFirst({
      where: { changeSetId: id, office: { code: officeCode } },
      select: { id: true, zip: true, expiresAt: true, firstDownloadedAt: true },
    });
    if (!archive) {
      throw new NotFoundException(`Change set #${id} has no archive for office ${officeCode}`);
    }
    if (archive.expiresAt.getTime() < Date.now()) {
      if (archive.zip) {
        await this.prisma.changeSetArchive.update({
          where: { id: archive.id },
          data: { zip: null },
        });
      }
      throw new GoneException(
        `The archive of ${officeCode} for change set #${id} expired on ${archive.expiresAt.toISOString()}. ` +
          `The owners' secrets are unrecoverable — the affected plots must be re-issued.`,
      );
    }
    if (!archive.zip) {
      throw new NotFoundException(`Change set #${id} has no archive for office ${officeCode}`);
    }

    if (archive.firstDownloadedAt === null) {
      // The where makes concurrent first downloads stamp once.
      await this.prisma.changeSetArchive.updateMany({
        where: { id: archive.id, firstDownloadedAt: null },
        data: { firstDownloadedAt: new Date(), firstDownloadedByOfficeId: actor.officeId },
      });
    }
    return { zip: Buffer.from(archive.zip), filename: roundArchiveFilename(id, officeCode) };
  }

  // D88: a branch sees only its own office's archives.
  private ownOffice(actor: Actor): { officeId?: number } {
    return actor.scope === 'BRANCH' ? { officeId: actor.officeId } : {};
  }

  private async summaries(where: {
    changeSetId?: number;
    officeId?: number;
  }): Promise<ArchiveSummaryDto[]> {
    const [rows, offices] = await Promise.all([
      this.prisma.changeSetArchive.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: [{ changeSetId: 'desc' }, { office: { code: 'asc' } }],
      }),
      officeCodes(this.prisma),
    ]);
    const now = Date.now();
    return rows.map((row) => ({
      changeSetId: row.changeSetId,
      rootVersion: row.changeSet.rootVersion,
      publishedAt: row.changeSet.publishedAt,
      officeCode: row.office.code,
      officeName: row.office.name,
      propertyCount: row.propertyCount,
      expiresAt: row.expiresAt,
      expired: row.expiresAt.getTime() < now,
      firstDownloadedAt: row.firstDownloadedAt,
      firstDownloadedByOfficeCode:
        row.firstDownloadedByOfficeId === null
          ? null
          : (offices.get(row.firstDownloadedByOfficeId) ?? null),
    }));
  }
}
