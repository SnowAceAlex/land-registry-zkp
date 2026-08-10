import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

/**
 * BundleClaimService
 * ─────────────────────────────────────────────────────────────────────────────
 * Storage and one-time handover of built bundles (D34).
 *
 * Sits beside IssuanceService rather than in the government module because the
 * two halves are one lifecycle: IssuanceService builds a ZIP containing an
 * ownerSecret, this decides how long that ZIP exists server-side and who may
 * take it. The government flow triggers issuance; it does not own the secret's
 * custody.
 *
 * That separation is also what keeps the D34 fallback cheap — if one-time claim
 * links are rejected in favour of a single government-side archive distributed
 * outside the system, only this file changes.
 */

const BUNDLE_TTL_DAYS = 7;

@Injectable()
export class BundleClaimService {
  constructor(private readonly prisma: PrismaService) {}

  /** When bundles created now stop being downloadable. */
  expiryFrom(issuedAt: Date): Date {
    return new Date(issuedAt.getTime() + BUNDLE_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Prisma statements that store one bundle each against a fresh claim token.
   *
   * Returned rather than executed so issuance can run them inside the same
   * transaction as the property updates and the proof-cache refresh: a bundle
   * row that survives a failed issuance would hand out a secret for a
   * commitment that was never published.
   */
  createStatements(bundles: { propertyId: string; zip: Buffer }[], expiresAt: Date) {
    return bundles.map((bundle) =>
      this.prisma.issuedBundle.create({
        data: {
          propertyId: bundle.propertyId,
          claimToken: randomBytes(32).toString('hex'),
          // Prisma's Bytes maps to Uint8Array; Buffer is one, but its generic
          // ArrayBufferLike does not narrow automatically.
          bundleZip: new Uint8Array(bundle.zip),
          expiresAt,
        },
      }),
    );
  }

  /** The stored bundles for a set of properties, with their claim tokens. */
  async findByPropertyIds(propertyIds: string[]) {
    return this.prisma.issuedBundle.findMany({
      where: { propertyId: { in: propertyIds } },
    });
  }

  /** Properties whose bundle has been issued but not yet downloaded. */
  async pendingPropertyIds(propertyIds: string[]): Promise<string[]> {
    const pending = await this.prisma.issuedBundle.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { propertyId: true },
    });
    return pending.map((bundle) => bundle.propertyId);
  }

  /**
   * Hand a bundle over exactly once. The row is deleted in the same request
   * that reads it, so a second attempt — including a replayed link — finds
   * nothing. This is what bounds the window in which an ownerSecret exists
   * server-side (D34).
   */
  async claim(claimToken: string): Promise<{ propertyId: string; zip: Buffer }> {
    const bundle = await this.prisma.issuedBundle.findUnique({ where: { claimToken } });
    if (!bundle) {
      throw new NotFoundException(
        'This download link is not valid. It may have already been used — ' +
          'bundles can only be downloaded once.',
      );
    }

    if (bundle.expiresAt.getTime() < Date.now()) {
      await this.prisma.issuedBundle.delete({ where: { id: bundle.id } });
      throw new GoneException(
        `This download link expired on ${bundle.expiresAt.toISOString()}. ` +
          `Ask the issuing authority to re-issue the bundle.`,
      );
    }

    // Delete first: if the response fails midway the bundle is gone either way,
    // and that is the safer failure — a link that can be replayed is not.
    await this.prisma.issuedBundle.delete({ where: { id: bundle.id } });

    return { propertyId: bundle.propertyId, zip: Buffer.from(bundle.bundleZip) };
  }
}
