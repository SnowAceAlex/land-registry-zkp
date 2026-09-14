import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PropertyStatus } from '@prisma/client';

import { ChainService } from '../chain/chain.service';
import {
  PaginationParams,
  pageArgs,
  serializePropertyFull,
  serializePropertySummary,
} from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import {
  PropertyListResponseDto,
  PropertyDetailDto,
  RegistryStatusResponseDto,
} from './dto/government.response.dto';

/** The browsing view: enough to scan a page of plots, no certificate fields. */
const SUMMARY_PROPERTY_SELECT = {
  propertyId: true,
  landUseCode: true,
  address: true,
  area: true,
  useType: true,
  tenureType: true,
  encumbranceStatus: true,
  validityPeriod: true,
  ownerCommitment: true,
  rootVersion: true,
  issuedAt: true,
  status: true,
} as const;

/** The detail view: the summary plus every descriptive certificate field.
 *  Guarded — none of these reach the unauthenticated `/api/records*` tier. */
const FULL_PROPERTY_SELECT = {
  ...SUMMARY_PROPERTY_SELECT,
  certificateSerial: true,
  bookEntryNumber: true,
  landUserType: true,
  culturalPreservation: true,
  mapSheetNumber: true,
  landOrigin: true,
  issuingAuthority: true,
  issueDate: true,
} as const;

/**
 * Parse the `status` query of `GET /government/properties`.
 *
 * An unknown value is a 400, not an ignored filter: the issuance screen asks
 * for `IMPORTED` precisely so it never offers an issued plot, and a typo that
 * silently returned every row would do exactly that.
 */
export function parsePropertyStatus(value: string | undefined): PropertyStatus | undefined {
  if (value === undefined || value === '') return undefined;
  const statuses = Object.values(PropertyStatus) as string[];
  if (!statuses.includes(value)) {
    throw new BadRequestException(`status must be one of ${statuses.join(', ')}`);
  }
  return value as PropertyStatus;
}

/**
 * GovernmentService
 * ─────────────────────────────────────────────────────────────────────────────
 * What is left of the state-authority operations after the single-phase
 * on-chain issuance flow (issueBatch()/publishRoot(), both backend-signed)
 * was removed: the status and property-listing views.
 *
 * Issuing land records is now the two-phase draft/confirm flow (D43) —
 * IssuanceBatchService in issuance/, not here — because a Metamask-signed
 * root can no longer be produced by a single backend call. Publishing a root
 * outside of issuance (e.g. to pick up manual DB edits) will similarly move
 * to a signed flow; there is no replacement endpoint for it yet.
 */

@Injectable()
export class GovernmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  /**
   * One page of properties, optionally of a single status. The total is counted
   * under the same filter, so page math on the issuance screen (IMPORTED only)
   * matches what it can actually page through.
   */
  async listProperties(
    params: PaginationParams = {},
    status?: PropertyStatus,
  ): Promise<PropertyListResponseDto> {
    const where = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({
        ...pageArgs(params),
        where,
        orderBy: { id: 'asc' },
        select: SUMMARY_PROPERTY_SELECT,
      }),
      this.prisma.property.count({ where }),
    ]);

    return {
      total,
      items: items.map(serializePropertySummary),
    };
  }

  /** The guarded counterpart of {@link listProperties} for a single property —
   *  same field set, same reasoning: an officer behind `ApiKeyGuard` needs the
   *  descriptive certificate fields the public `/api/records/:propertyId`
   *  route deliberately omits. */
  async getProperty(propertyId: string): Promise<PropertyDetailDto> {
    const property = await this.prisma.property.findUnique({
      where: { propertyId },
      select: FULL_PROPERTY_SELECT,
    });
    if (!property) {
      throw new NotFoundException(`Unknown propertyId ${propertyId}`);
    }
    return serializePropertyFull(property);
  }

  /** Current on-chain state, for the portal header and for sanity checks. */
  async registryStatus(): Promise<RegistryStatusResponseDto> {
    const [root, version, latestRecord] = await Promise.all([
      this.chain.getLatestRoot(),
      this.chain.getRootVersion(),
      this.prisma.merkleRoot.findFirst({ orderBy: { version: 'desc' } }),
    ]);

    return {
      network: this.chain.network,
      chainId: this.chain.chainId,
      contractAddress: this.chain.rootRegistryAddress,
      authority: this.chain.authorityAddress,
      onChain: { root: root.toString(), version },
      // A mismatch means the DB and chain drifted, e.g. the chain was reset
      // or a draft batch was confirmed and published a root this row predates.
      database: latestRecord
        ? { root: latestRecord.root, version: latestRecord.version, txHash: latestRecord.txHash }
        : null,
      inSync: latestRecord ? latestRecord.root === root.toString() : version === 0,
    };
  }
}
