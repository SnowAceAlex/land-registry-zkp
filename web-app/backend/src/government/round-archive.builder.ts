import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Property } from '@prisma/client';
import type { TreeOverlay } from '@land-registry/blockchain/shared';

import { ChainService } from '../chain/chain.service';
import { HEAD_OFFICE_CODE } from '../common/actor';
import { ArchiveService, ArchiveEntry } from '../issuance/archive.service';
import { IssuanceService } from '../issuance/issuance.service';
import { NodeStoreService } from '../tree/node-store.service';

export interface RoundArchiveBuildInput {
  changeSetId: number;
  txHash: string | null;
  rootVersion: number;
  overlay: TreeOverlay;
  issuances: { propertyId: string; ownerCommitment: string; ownerSecret: string | null }[];
  transfers: { propertyId: string; newOwnerCommitment: string; newOwnerSecret: string | null }[];
  before: Map<string, Property>;
  newLeaves: Map<string, string>;
  publishedAt: Date;
  /** office id → code, as loaded by `officeCodes()`. */
  offices: Map<number, string>;
}

export interface OfficeArchive {
  officeId: number;
  officeCode: string;
  zip: Buffer;
  propertyCount: number;
}

/**
 * Builds a round's bundles from the PROJECTED tree (the node table still holds the tree
 * from before the round) and splits them into one archive per land office (D88).
 */
@Injectable()
export class RoundArchiveBuilder {
  constructor(
    private readonly nodes: NodeStoreService,
    private readonly chain: ChainService,
    private readonly issuance: IssuanceService,
    private readonly archive: ArchiveService,
  ) {}

  async build(input: RoundArchiveBuildInput): Promise<OfficeArchive[]> {
    const owners = [
      ...input.issuances.map((request) => ({
        kind: 'issued' as const,
        propertyId: request.propertyId,
        ownerCommitment: request.ownerCommitment,
        ownerSecret: request.ownerSecret,
      })),
      ...input.transfers.map((transfer) => ({
        kind: 'transferred' as const,
        propertyId: transfer.propertyId,
        ownerCommitment: transfer.newOwnerCommitment,
        ownerSecret: transfer.newOwnerSecret,
      })),
    ];
    if (owners.length === 0) return [];

    const { issuer, issuedOn } = this.issuance.batchContext();
    const context = {
      rootVersion: input.rootVersion,
      merkleRoot: input.overlay.root,
      transactionHash: input.txHash ?? '',
      contractAddress: this.chain.rootRegistryAddress,
      explorerTxUrlPrefix: this.chain.explorerTxUrlPrefix,
    };

    const byOffice = new Map<number, ArchiveEntry[]>();
    for (const owner of owners) {
      const property = {
        ...input.before.get(owner.propertyId)!,
        ownerCommitment: owner.ownerCommitment,
      };
      const leaf = BigInt(input.newLeaves.get(owner.propertyId)!);
      const merkleProof = await this.nodes.proofInOverlay(property, leaf, input.overlay);
      const built = await this.issuance.buildBundleFiles(
        { property, ownerSecret: BigInt(owner.ownerSecret!), merkleProof },
        context,
        issuer,
        issuedOn,
      );
      // A plot with no assigned office belongs to the head office.
      const officeId = property.landOfficeId ?? this.headOfficeId(input.offices);
      const entries = byOffice.get(officeId) ?? [];
      entries.push({
        propertyId: property.propertyId,
        certificateSerial: property.certificateSerial,
        leaf: leaf.toString(),
        kind: owner.kind,
        files: built.files,
      });
      byOffice.set(officeId, entries);
    }

    const result: OfficeArchive[] = [];
    for (const [officeId, entries] of byOffice) {
      const officeCode = input.offices.get(officeId)!;
      const zip = await this.archive.buildRound({
        roundId: input.changeSetId,
        officeCode,
        rootVersion: input.rootVersion,
        txHash: input.txHash,
        publishedAt: input.publishedAt,
        entries,
      });
      result.push({ officeId, officeCode, zip, propertyCount: entries.length });
    }
    return result;
  }

  private headOfficeId(offices: Map<number, string>): number {
    for (const [id, code] of offices) if (code === HEAD_OFFICE_CODE) return id;
    throw new UnprocessableEntityException(
      `Office ${HEAD_OFFICE_CODE} is missing from the catalog, so plots without a land office have no archive.`,
    );
  }
}
