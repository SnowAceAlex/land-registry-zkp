import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Property } from '@prisma/client';

import { ChainService } from '../chain/chain.service';
import { PaginationParams, pageArgs, serializeProperty } from '../common/pagination';
import { BundleClaimService } from '../issuance/bundle-claim.service';
import { IssuanceService } from '../issuance/issuance.service';
import { PrismaService } from '../prisma/prisma.service';
import { RootService } from './root.service';
import { TreeService } from '../tree/tree.service';
import {
  IssueBatchResponseDto,
  PropertyListResponseDto,
  PublishRootResponseDto,
  RegistryStatusResponseDto,
} from './dto/government.response.dto';

/**
 * GovernmentService
 * ─────────────────────────────────────────────────────────────────────────────
 * The state authority's operations: issue a batch of land records, publish
 * roots, and hand each owner their bundle.
 *
 * ISSUANCE MODEL (D34) — batch on-chain, per-owner off-chain:
 *   1. generate one ownerSecret per property (in memory only)
 *   2. build the tree that includes them and publish it in ONE transaction
 *      (batching is why this is cheap: N properties, one publishRoot)
 *   3. build one bundle per property and store it against a one-time claim
 *      token; each owner downloads only their own
 *
 * Steps 1 and 3 belong to IssuanceModule — building bundles and deciding how
 * long a secret exists server-side are its concern, not the portal's. What is
 * orchestrated here is the ORDER, which is the part that matters.
 */

@Injectable()
export class GovernmentService {
  private readonly logger = new Logger(GovernmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: TreeService,
    private readonly chain: ChainService,
    private readonly issuance: IssuanceService,
    private readonly bundles: BundleClaimService,
    private readonly roots: RootService,
  ) {}

  async issueBatch(propertyIds: string[]): Promise<IssueBatchResponseDto> {
    const batch = await this.loadIssuableBatch(propertyIds);

    // 1. Secrets exist only here and inside the bundles built below (D14).
    const secrets = new Map<string, bigint>();
    const withCommitments: Property[] = [];
    for (const property of batch) {
      const ownerSecret = this.issuance.generateOwnerSecret();
      const ownerCommitment = await this.issuance.commitmentFor(ownerSecret);
      secrets.set(property.propertyId, ownerSecret);
      withCommitments.push({ ...property, ownerCommitment: ownerCommitment.toString() });
    }

    // 2. One tree over already-issued properties plus this batch, one publish.
    const alreadyIssued = await this.tree.loadIssuedProperties();
    const { tree, properties } = await this.tree.buildFrom([...alreadyIssued, ...withCommitments]);
    const published = await this.chain.publishRoot(tree.root);

    // 3. Bundles for this batch only; proofs refresh for everyone (see RootService).
    const sources = await Promise.all(
      withCommitments.map(async (property) => ({
        property,
        ownerSecret: secrets.get(property.propertyId)!,
        merkleProof: await this.tree.proofFor(tree, property),
      })),
    );

    const bundles = await this.issuance.buildBundles(sources, {
      rootVersion: published.version,
      merkleRoot: published.root,
      transactionHash: published.txHash,
      contractAddress: this.chain.rootRegistryAddress,
      explorerTxUrlPrefix:
        this.chain.network === 'sepolia' ? 'https://sepolia.etherscan.io/tx/' : undefined,
    });

    const issuedAt = new Date();
    const expiresAt = this.bundles.expiryFrom(issuedAt);
    const issuedIds = withCommitments.map((p) => p.propertyId);

    try {
      await this.prisma.$transaction([
        ...withCommitments.map((property) =>
          this.prisma.property.update({
            where: { propertyId: property.propertyId },
            data: { ownerCommitment: property.ownerCommitment, issuedAt },
          }),
        ),
        this.roots.recordRootStatement(published),
        ...(await this.roots.proofCacheStatements(tree, properties, published.version)),
        ...this.bundles.createStatements(bundles, expiresAt),
      ]);
    } catch (error) {
      this.roots.warnChainAheadOfDatabase(published.txHash, error);
      throw error;
    }

    const stored = await this.bundles.findByPropertyIds(issuedIds);

    this.logger.log(
      `issued ${bundles.length} bundle(s) under root version ${published.version} ` +
        `(tx ${published.txHash})`,
    );

    return {
      root: published.root.toString(),
      version: published.version,
      txHash: published.txHash,
      bundles: stored.map((bundle) => ({
        propertyId: bundle.propertyId,
        claimUrl: `/api/bundles/claim/${bundle.claimToken}`,
        expiresAt: bundle.expiresAt,
      })),
    };
  }

  /** Rebuild from DB state and publish — used after edits, or to re-sync. */
  async publishRoot(): Promise<PublishRootResponseDto> {
    const result = await this.roots.rebuildAndPublish();
    return {
      root: result.root.toString(),
      version: result.version,
      txHash: result.txHash,
      published: result.published,
      message: result.published
        ? `Published root version ${result.version}`
        : 'Registry was already up to date — no transaction sent; cached proofs refreshed',
    };
  }

  async listProperties(params: PaginationParams = {}): Promise<PropertyListResponseDto> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({
        ...pageArgs(params),
        orderBy: { id: 'asc' },
        select: {
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
        },
      }),
      this.prisma.property.count(),
    ]);

    return {
      total,
      items: items.map(serializeProperty),
    };
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
      contractAddress: this.chain.rootRegistryAddress,
      authority: this.chain.authorityAddress,
      onChain: { root: root.toString(), version },
      // A mismatch means the DB and chain drifted — publish-root reconciles it.
      database: latestRecord
        ? { root: latestRecord.root, version: latestRecord.version, txHash: latestRecord.txHash }
        : null,
      inSync: latestRecord ? latestRecord.root === root.toString() : version === 0,
    };
  }

  /**
   * Load the batch, refusing anything that would produce an unusable or
   * duplicated issuance.
   */
  private async loadIssuableBatch(propertyIds: string[]): Promise<Property[]> {
    const unique = [...new Set(propertyIds)];
    const properties = await this.prisma.property.findMany({
      where: { propertyId: { in: unique } },
    });

    const missing = unique.filter((id) => !properties.some((p) => p.propertyId === id));
    if (missing.length > 0) {
      throw new NotFoundException(`Unknown propertyId(s): ${missing.join(', ')}`);
    }

    const alreadyIssued = properties.filter((p) => p.ownerCommitment !== null);
    if (alreadyIssued.length > 0) {
      throw new ConflictException(
        `Already issued: ${alreadyIssued.map((p) => p.propertyId).join(', ')}. ` +
          `Re-issuing would replace the owner's secret and invalidate their bundle.`,
      );
    }

    const pending = await this.bundles.pendingPropertyIds(unique);
    if (pending.length > 0) {
      throw new ConflictException(`Bundle(s) still awaiting download for: ${pending.join(', ')}`);
    }

    if (properties.length === 0) {
      throw new BadRequestException('No properties to issue');
    }
    return properties;
  }
}
