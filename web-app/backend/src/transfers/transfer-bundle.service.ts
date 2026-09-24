import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';

import { ChainService } from '../chain/chain.service';
import { IssuanceService } from '../issuance/issuance.service';
import { PrismaService } from '../prisma/prisma.service';
import { NodeStoreService } from '../tree/node-store.service';

/**
 * TransferBundleService — the new owner's receipt after a published transfer (D51).
 *
 * `transfer.circom` needs both parties' secrets in one witness, so the buyer's
 * secret is generated in the officer's browser and handed over at the counter;
 * this backend never sees it. What the buyer still lacks after the change set
 * publishes is the shareable half — a receipt.json naming their commitment, and
 * the certificate printed from it — which is what this builds.
 *
 * It is built here, after publication, and not at the counter: before the
 * change set publishes there is no transactionHash, rootVersion or root to put
 * in it, and a round batching several transfers invalidates the preview's
 * Merkle path. A receipt that `receipt:verify` rejects the day it is issued is
 * not something to hand to a resident.
 *
 * The snapshot is internally consistent by construction: the tree is rebuilt
 * from the database (the same source the transfer preview uses) and accepted
 * only when its root IS the chain's latestRoot, and the transactionHash is that
 * root version's own — not the change set's, which describes an older root as
 * soon as anything else publishes.
 */
@Injectable()
export class TransferBundleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeStoreService,
    private readonly chain: ChainService,
    private readonly issuance: IssuanceService,
  ) {}

  async build(id: number): Promise<{ zip: Buffer; filename: string }> {
    const transfer = await this.prisma.transferRequest.findUnique({ where: { id } });
    if (!transfer) throw new NotFoundException(`Unknown transfer request #${id}`);
    if (transfer.status !== 'PUBLISHED') {
      throw new ConflictException(
        `Transfer request #${id} is ${transfer.status}; the new owner's bundle exists only once ` +
          `a change set has published it (D46)`,
      );
    }

    const property = await this.prisma.property.findUnique({
      where: { propertyId: transfer.propertyId },
    });
    if (!property) throw new NotFoundException(`Unknown propertyId ${transfer.propertyId}`);
    if (property.status === 'REVOKED') {
      throw new GoneException(
        `The certificate for property ${property.propertyId} has been revoked since this transfer; ` +
          `no Merkle proof exists for it any more.`,
      );
    }
    if (property.ownerCommitment !== transfer.newOwnerCommitment) {
      throw new ConflictException(
        `Property ${property.propertyId} has changed hands again since transfer #${id}; ` +
          `download the bundle of the latest transfer instead.`,
      );
    }

    // One row for the stored root instead of a whole-tree rebuild (D72). The
    // check itself is unchanged and load-bearing: a receipt built against a root
    // the chain has not published would not verify for the buyer.
    const [storedRoot, latestRoot, rootVersion] = await Promise.all([
      this.nodes.rootNow(),
      this.chain.getLatestRoot(),
      this.chain.getRootVersion(),
    ]);
    if (storedRoot !== latestRoot) {
      throw new ConflictException(
        `The registry database does not match the published root (version ${rootVersion}), so ` +
          `a receipt built now would not verify. Confirm or discard the open draft, or check ` +
          `GET /api/government/status.`,
      );
    }

    const merkleProof = await this.nodes.proofFor(property);
    const rootRecord = await this.prisma.merkleRoot.findUnique({ where: { version: rootVersion } });

    const { zip } = await this.issuance.buildBuyerBundle(
      { property, merkleProof },
      {
        rootVersion,
        merkleRoot: latestRoot,
        transactionHash: rootRecord?.txHash ?? '',
        contractAddress: this.chain.rootRegistryAddress,
        explorerTxUrlPrefix: this.chain.explorerTxUrlPrefix,
      },
      transfer.decidedAt ?? new Date(),
    );

    return { zip, filename: `transfer-${id}-property-${property.propertyId}.zip` };
  }
}
