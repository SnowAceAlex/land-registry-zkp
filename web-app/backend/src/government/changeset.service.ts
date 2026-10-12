import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ChangeSet, DraftStatus, Property, Revocation, TransferRequest } from '@prisma/client';
import { type TreeOverlay, hashRecord } from '@land-registry/blockchain/shared';

import { ChainService } from '../chain/chain.service';
import { DraftLockService } from '../common/draft-lock.service';
import { ARCHIVE_TTL_DAYS, ArchiveEntry, ArchiveService } from '../issuance/archive.service';
import { IssuanceService } from '../issuance/issuance.service';
import { PropertyEventService } from '../history/property-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { NodeStoreService } from '../tree/node-store.service';
import { toLURRecord } from '../records/record.mapper';
import { TransferRequestDto } from '../transfers/dto/transfer.response.dto';
import { toTransferRequestDto } from '../transfers/transfer-request.serializer';
import { RootService } from './root.service';

/**
 * Most revocations one change set may carry (D56, re-measured at D73).
 *
 * `publishRootWithRevocations` caps nothing itself, and a batch past the block
 * gas limit reverts WHOLESALE — nothing publishes at all. The cap lives here
 * rather than in the portal because `createDraft()` takes the entire queue:
 * there is no selection step a UI could limit.
 *
 * Measured in `blockchain/test/contracts/RootRegistry.revocation.test.ts`, on a
 * linear ~93k gas per revocation:
 *
 *     50 → 4,743,185    100 → 9,369,525    150 → 13,996,021    180 → 16,771,994
 *     190 and above → estimateGas itself fails on the dev network
 *
 * 150 is the largest rung still under half of a 30M block, which leaves room
 * for a gas-price spike, for other transactions in the same block, and for a
 * real mined call costing more than its estimate.
 *
 * Why 50 was too small: ~20,890 certificates are re-issued each month in HCMC
 * (re-books, splits and merges = revoke + issue), which at 50 a round is ~418
 * change sets a month — every one of them a publish and a wallet signature.
 */
export const MAX_REVOCATIONS_PER_CHANGESET = 150;

/** Arguments for `RootRegistry.publishRootWithRevocations`, index-aligned. */
export interface RevocationCalldata {
  propertyIds: string[];
  reasonCodes: number[];
  detailHashes: string[];
}

/** Summary row for `list()` — deliberately excludes `archiveZip` (D77). */
export interface ChangeSetSummary {
  id: number;
  status: DraftStatus;
  newRoot: string;
  rootVersion: number | null;
  txHash: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archiveExpiresAt: Date | null;
  transferCount: number;
  revocationCount: number;
}

/** What a portal needs to sign (or resume signing) a change-set draft (D53). */
export interface ChangeSetDraftDetail {
  kind: 'changeset';
  id: number;
  newRoot: string;
  createdAt: Date;
  transferIds: number[];
  revocationIds: number[];
  revocationCalldata: RevocationCalldata;
  /** Pending revocations left for a later round by the cap (D56). */
  deferredRevocations: number;
}

/**
 * ChangeSetService — one publishing round of approved transfers and revocations (D44/D46).
 *
 * Mirrors IssuanceBatchService's two-phase draft/confirm/discard shape (D43): a
 * DRAFT is a durable, inert record — createDraft() only `connect`s the
 * TransferRequest and Revocation rows it covers, never writes to Property or
 * to either row's `status` — and confirm() re-verifies against the chain
 * before applying anything for real.
 *
 * What differs from issuance is where the new root comes from. A transfer
 * proof's public signals carry a `newRoot`, but that value was computed
 * assuming only that ONE transfer happened; batching N transfers (and
 * revocations) together produces one root, not N superseding ones. So the
 * proof is authorisation evidence — proof that whoever submitted it held the
 * old owner's secret — never a source of truth for the tree. The tree here is
 * always rebuilt from the database, with every change in the round applied in
 * memory first, exactly the way IssuanceBatchService rebuilds from the
 * database rather than trusting anything computed at draft time.
 *
 * A revocation's enforcement falls out of that same rebuild for free: a
 * revoked plot is excluded because its Property.status becomes REVOKED
 * (membership is `status === ISSUED`, D45), so no Merkle path exists for it in
 * the new tree and the ownership/mortgage/transfer circuits simply cannot
 * produce a proof for it afterwards. The on-chain `revocations` mapping this
 * draft's calldata feeds is for public auditability, not enforcement —
 * enforcement is already free.
 *
 * Since D77 a round with transfers also produces an archive: each transferred
 * plot's folder holds the buyer's receipt, secret, certificate and README,
 * exactly like an issuance folder, and the secrets leave the TransferRequest
 * rows in the same transaction that stores it.
 */
@Injectable()
export class ChangeSetService {
  private readonly logger = new Logger(ChangeSetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeStoreService,
    private readonly chain: ChainService,
    private readonly roots: RootService,
    private readonly lock: DraftLockService,
    private readonly events: PropertyEventService,
    private readonly issuance: IssuanceService,
    private readonly archive: ArchiveService,
  ) {}

  /**
   * Everything eligible for the next change set, as the portal sees it, plus
   * the cap (D73). Transfers go through toTransferRequestDto: the rows hold the
   * buyers' secrets until a change set archives them (D77).
   */
  async pending(): Promise<{
    transfers: TransferRequestDto[];
    revocations: Revocation[];
    revocationCap: number;
  }> {
    const { transfers, revocations } = await this.queue();
    return {
      transfers: transfers.map(toTransferRequestDto),
      revocations,
      revocationCap: MAX_REVOCATIONS_PER_CHANGESET,
    };
  }

  /** The raw queue — rows with their secrets, for this service only. */
  private async queue(): Promise<{ transfers: TransferRequest[]; revocations: Revocation[] }> {
    const [transfers, revocations] = await Promise.all([
      this.prisma.transferRequest.findMany({
        where: { status: 'APPROVED', changeSetId: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.revocation.findMany({
        // changeSetId: null mirrors the transfer query above. Without it, a
        // revocation already `connect`ed to an open DRAFT would still be
        // reported as "pending" here — misleading even though
        // DraftLockService is already refusing to start a second draft that
        // could batch it again.
        where: { status: 'PENDING', changeSetId: null },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { transfers, revocations };
  }

  /**
   * Phase 1 — gather every approved transfer and pending revocation, project
   * the ONE root that applying all of them at once produces, and store it as a
   * draft. No Property, TransferRequest or Revocation row is written here —
   * only `connect`ed to the new draft — so an abandoned draft can never leave
   * any of them in a half-applied state.
   */
  async createDraft(): Promise<ChangeSetDraftDetail> {
    await this.lock.assertNoOpenDraft();

    const { transfers, revocations: pendingRevocations } = await this.queue();
    if (transfers.length === 0 && pendingRevocations.length === 0) {
      throw new ConflictException('Nothing to publish — no approved transfers, no revocations');
    }

    // Defence in depth. TransfersService.submit() already refuses a second
    // transfer while one is PENDING or APPROVED for the same property, and
    // RevocationService.request() refuses a second pending revocation for the
    // same property — but neither knows about the other. If a plot somehow
    // had both, this batch would be asked to simultaneously keep it (under a
    // new owner) and drop it from the tree. Refuse instead of silently
    // picking one.
    //
    // Checked against the WHOLE queue, deferred revocations included: a plot
    // transferred in this round and revoked in the next is the same conflict,
    // just spread over two publishes.
    // The message names what was actually found. The set used to be shared
    // between both lists, so two queued transfers for one plot were reported as
    // "a transfer and a revocation" — an officer sent looking for a revocation
    // that does not exist. Keeping the two kinds apart costs one extra set and
    // makes the error actionable.
    const transferred = new Set<string>();
    const revoked = new Set<string>();
    for (const transfer of transfers) {
      if (transferred.has(transfer.propertyId)) {
        throw new ConflictException(
          `Property ${transfer.propertyId} has more than one approved transfer waiting — ` +
            `reject all but one before publishing.`,
        );
      }
      transferred.add(transfer.propertyId);
    }
    for (const revocation of pendingRevocations) {
      if (revoked.has(revocation.propertyId)) {
        throw new ConflictException(
          `Property ${revocation.propertyId} has more than one pending revocation — ` +
            `reject all but one before publishing.`,
        );
      }
      if (transferred.has(revocation.propertyId)) {
        throw new ConflictException(
          `Property ${revocation.propertyId} has both a transfer and a revocation pending — ` +
            `resolve the conflict before publishing.`,
        );
      }
      revoked.add(revocation.propertyId);
    }

    // D77 — the buyer's secret travels with the request into this round's
    // archive. A request submitted before D77 has none (the buyer took it home
    // from the counter), and publishing its commitment would leave a plot whose
    // archive holds no key. Refuse and name them.
    const secretless = transfers.filter((transfer) => transfer.newOwnerSecret === null);
    if (secretless.length > 0) {
      throw new ConflictException(
        `Transfer request(s) ${secretless.map((t) => `#${t.id}`).join(', ')} carry no buyer ` +
          `secret — they were submitted before D77. Reject them and redo the transfers at the counter.`,
      );
    }

    // D56 — oldest first (queue() orders by createdAt), the rest wait.
    const revocations = pendingRevocations.slice(0, MAX_REVOCATIONS_PER_CHANGESET);

    // Project every change at once and take ONE root. N transfers and
    // revocations batched together produce one root, not N. Only the plots in
    // this round are read (D72) — the projection walks up from their leaves
    // instead of rebuilding the registry.
    const { updates } = await this.leafUpdatesFor(transfers, revocations);
    const overlay = await this.nodes.projectRoot(updates);

    // No relation `connect` touches Property here — same reasoning as
    // IssuanceBatchService.createDraft(): only confirm() may write it, and
    // only after a signature.
    const draft = await this.prisma.changeSet.create({
      data: {
        status: 'DRAFT',
        newRoot: overlay.root.toString(),
        transfers: { connect: transfers.map((t) => ({ id: t.id })) },
        revocations: { connect: revocations.map((r) => ({ id: r.id })) },
      },
    });

    this.logger.log(
      `change set draft #${draft.id}: ${transfers.length} transfer(s), ` +
        `${revocations.length} revocation(s), projected root ${overlay.root}`,
    );

    return this.toDraftDetail(
      draft,
      transfers,
      revocations,
      pendingRevocations.length - revocations.length,
    );
  }

  /**
   * An open draft as the portal sees it (D53) — the same shape createDraft()
   * returned, rebuilt from the stored relations. Without it a session that
   * lost that response could never sign again: pending() excludes everything
   * already connected to a draft, so the calldata would exist nowhere.
   */
  async draftDetail(id: number): Promise<ChangeSetDraftDetail> {
    const draft = await this.prisma.changeSet.findUnique({
      where: { id },
      include: {
        transfers: { orderBy: { createdAt: 'asc' } },
        revocations: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    const deferred = await this.prisma.revocation.count({
      where: { status: 'PENDING', changeSetId: null },
    });
    return this.toDraftDetail(draft, draft.transfers, draft.revocations, deferred);
  }

  /**
   * One mapping for createDraft() and draftDetail(), so the calldata a resumed
   * session signs is built by the same code as the calldata first shown. Order
   * does not affect the root (it is rebuilt from the database) — only the
   * order the contract writes its `revocations` mapping in.
   */
  private toDraftDetail(
    draft: Pick<ChangeSet, 'id' | 'newRoot' | 'createdAt'>,
    transfers: Pick<TransferRequest, 'id'>[],
    revocations: Pick<Revocation, 'id' | 'propertyId' | 'reasonCode' | 'detailHash'>[],
    deferredRevocations: number,
  ): ChangeSetDraftDetail {
    return {
      kind: 'changeset',
      id: draft.id,
      newRoot: draft.newRoot,
      createdAt: draft.createdAt,
      transferIds: transfers.map((t) => t.id),
      revocationIds: revocations.map((r) => r.id),
      revocationCalldata: {
        propertyIds: revocations.map((r) => r.propertyId),
        reasonCodes: revocations.map((r) => r.reasonCode),
        detailHashes: revocations.map((r) => r.detailHash),
      },
      deferredRevocations,
    };
  }

  /**
   * Phase 2 — the officer has signed both the root and (when the round
   * includes any) the revocation calldata. Verify against the CHAIN, not
   * against anything the caller says, then apply everything in one
   * transaction.
   */
  async confirm(
    id: number,
    txHash?: string,
  ): Promise<{
    id: number;
    rootVersion: number;
    txHash: string | null;
    transferIds: number[];
    revocationIds: number[];
  }> {
    const draft = await this.prisma.changeSet.findUnique({
      where: { id },
      include: { transfers: true, revocations: true },
    });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    // Same rule as createDraft(), re-checked because a draft may predate D77.
    // Before the chain read: nothing about this draft can be applied anyway.
    const secretless = draft.transfers.filter((transfer) => transfer.newOwnerSecret === null);
    if (secretless.length > 0) {
      throw new UnprocessableEntityException(
        `Transfer request(s) ${secretless.map((t) => `#${t.id}`).join(', ')} in change set #${id} ` +
          `carry no buyer secret. Discard this change set, reject them, and redo them at the counter.`,
      );
    }

    // `txHash` is a label for humans — surfaced later in history views so a
    // reader can jump to a block explorer — never evidence that the publish
    // happened. That authority stays exactly the chain read immediately
    // below. Stashing it on the in-memory draft here just makes every write
    // further down (the MerkleRoot row, the PropertyEvent rows, this row)
    // carry the same label; nothing branches on whether it is present.
    if (txHash !== undefined) {
      draft.txHash = txHash;
    }

    // D74 — the root read is cached for 2 seconds; a confirm must always ask
    // the chain itself, or a just-mined publish can be reported as unmined.
    this.chain.invalidateRootCache();
    const latestRoot = await this.chain.getLatestRoot();
    if (latestRoot.toString() !== draft.newRoot) {
      throw new UnprocessableEntityException(
        `On-chain latestRoot is ${latestRoot}, but this change set projects ${draft.newRoot}. ` +
          `The publish transaction has not been mined, or a different root was published.`,
      );
    }
    const rootVersion = await this.chain.getRootVersion();

    // `beforeById` is the "before" snapshot the history rows need:
    // previousOwnerCommitment / previousLeaf must describe the tree as it stood
    // before THIS round (PropertyEventService writes only forward-looking
    // rows). It comes out of leafUpdatesFor because that call already has to
    // read exactly these plots — reading them twice was the old shape.
    const {
      updates,
      newLeaves,
      before: beforeById,
    } = await this.leafUpdatesFor(draft.transfers, draft.revocations);
    const overlay = await this.nodes.projectRoot(updates);

    // Paranoia that has already paid for itself once in IssuanceBatchService:
    // if the re-projected root no longer matches the signed one, something moved
    // underneath the draft and applying it would corrupt the registry.
    if (overlay.root.toString() !== draft.newRoot) {
      throw new UnprocessableEntityException(
        `Reprojected root ${overlay.root} no longer matches the signed root ${draft.newRoot}. ` +
          `Discard this change set and start again.`,
      );
    }

    const decidedAt = new Date();
    const archiveZip =
      draft.transfers.length > 0
        ? await this.buildArchive({
            changeSetId: draft.id,
            txHash: draft.txHash,
            rootVersion,
            overlay,
            transfers: draft.transfers,
            before: beforeById,
            newLeaves,
            publishedAt: decidedAt,
          })
        : null;
    const archiveExpiresAt = new Date(decidedAt.getTime() + ARCHIVE_TTL_DAYS * 24 * 60 * 60 * 1000);

    try {
      await this.prisma.$transaction([
        ...draft.transfers.map((transfer) =>
          this.prisma.property.update({
            where: { propertyId: transfer.propertyId },
            data: {
              ownerCommitment: transfer.newOwnerCommitment,
              leaf: newLeaves.get(transfer.propertyId)!,
              rootVersion,
            },
          }),
        ),
        ...draft.transfers.map((transfer) =>
          this.prisma.transferRequest.update({
            where: { id: transfer.id },
            // D77 — the secret's copy of record is now the archive written by
            // the changeSet update below, in this same transaction.
            data: { status: 'PUBLISHED', txHash: draft.txHash, decidedAt, newOwnerSecret: null },
          }),
        ),

        // A revoked plot leaves the tree (status !== ISSUED, D45), and its leaf
        // is cleared along with the root version that leaf belonged to. The
        // node itself is deleted by `applyStatements` below — the two have to
        // agree, or a row would claim a leaf the tree no longer holds.
        ...draft.revocations.map((revocation) =>
          this.prisma.property.update({
            where: { propertyId: revocation.propertyId },
            data: { status: 'REVOKED', leaf: null, rootVersion: null },
          }),
        ),
        ...draft.revocations.map((revocation) =>
          this.prisma.revocation.update({
            where: { id: revocation.id },
            data: { status: 'PUBLISHED', publishedAt: decidedAt },
          }),
        ),

        this.roots.recordRootStatement({
          root: overlay.root,
          version: rootVersion,
          txHash: draft.txHash ?? '',
        }),
        // Writes exactly the nodes this round moved — O(k·TREE_DEPTH), not the
        // whole registry (D72). Every other owner needs no write at all: their
        // proof is read out of this same table when they ask for it. That is
        // the difference between one publish touching a few thousand rows and
        // one publish rewriting 2.5 million.
        ...this.nodes.applyStatements(overlay),

        ...this.events.transferredStatements(
          draft.transfers.map((transfer) => ({
            propertyId: transfer.propertyId,
            previousOwnerCommitment: beforeById.get(transfer.propertyId)?.ownerCommitment ?? null,
            newOwnerCommitment: transfer.newOwnerCommitment,
            previousLeaf: beforeById.get(transfer.propertyId)?.leaf ?? null,
            newLeaf: newLeaves.get(transfer.propertyId)!,
          })),
          { rootVersion, txHash: draft.txHash },
        ),
        ...this.events.revokedStatements(
          draft.revocations.map((revocation) => ({
            propertyId: revocation.propertyId,
            previousLeaf: beforeById.get(revocation.propertyId)?.leaf ?? null,
            reasonCode: revocation.reasonCode,
            // detailHash, never detailText: the free-text reason stays off the
            // public history the same way it stays off chain (see
            // PropertyEventService.RevokedEventInput).
            detailHash: revocation.detailHash,
          })),
          { rootVersion, txHash: draft.txHash },
        ),

        this.prisma.changeSet.update({
          where: { id: draft.id },
          data: {
            status: 'PUBLISHED',
            rootVersion,
            publishedAt: decidedAt,
            txHash: draft.txHash,
            // Same rule as IssuanceBatchService.confirm(): the secrets are
            // cleared above only because this archive lands in the same
            // transaction. Buffer IS a Uint8Array; see the cast there.
            ...(archiveZip
              ? { archiveZip: archiveZip as Uint8Array<ArrayBuffer>, archiveExpiresAt }
              : {}),
          },
        }),
      ]);
    } catch (error) {
      // The officer's wallet has already published this root on-chain (the
      // latestRoot check above confirms it) — a failure past this point
      // leaves the database behind a root that is now permanently true
      // on-chain. warnChainAheadOfDatabase exists precisely to surface that
      // loudly for manual reconciliation rather than let it pass silently.
      this.roots.warnChainAheadOfDatabase(draft.txHash ?? '', error);
      throw error;
    }

    this.logger.log(
      `change set #${draft.id} confirmed at root version ${rootVersion}: ` +
        `${draft.transfers.length} transfer(s), ${draft.revocations.length} revocation(s)`,
    );

    return {
      id: draft.id,
      rootVersion,
      txHash: draft.txHash,
      transferIds: draft.transfers.map((t) => t.id),
      revocationIds: draft.revocations.map((r) => r.id),
    };
  }

  /**
   * Exactly what one publishing round needs to know: the new leaf of every
   * transferred plot, `null` for every revoked one, and the "before" snapshot
   * the history rows are written from.
   *
   * ⚠️ Reads ONLY the plots in the round. Before D72 this loaded the entire
   * tree to rebuild a root; now `projectRoot()` walks up from these leaves, so
   * reading one plot outside the round would be pure waste.
   */
  private async leafUpdatesFor(
    transfers: { propertyId: string; newOwnerCommitment: string }[],
    revocations: { propertyId: string }[],
  ): Promise<{
    updates: Map<number, bigint | null>;
    newLeaves: Map<string, string>;
    before: Map<string, Property>;
  }> {
    const propertyIds = [
      ...transfers.map((transfer) => transfer.propertyId),
      ...revocations.map((revocation) => revocation.propertyId),
    ];
    const rows = await this.prisma.property.findMany({
      where: { propertyId: { in: propertyIds } },
    });
    const before = new Map(rows.map((property) => [property.propertyId, property]));

    const updates = new Map<number, bigint | null>();
    const newLeaves = new Map<string, string>();

    for (const transfer of transfers) {
      const property = before.get(transfer.propertyId);
      if (!property) {
        throw new UnprocessableEntityException(
          `Property ${transfer.propertyId} referenced by this round no longer exists. ` +
            `Discard the draft and start again.`,
        );
      }
      // ⚠️ The status check is load-bearing, and its absence would be silent.
      // Before D72 this method rebuilt from `loadIssuedProperties()`, which
      // filtered on ISSUED and therefore dropped a revoked plot by accident.
      // Reading by propertyId does not, so an APPROVED transfer left dangling
      // on a plot revoked in an EARLIER round would put its leaf back into the
      // tree — resurrecting a certificate the State has already reclaimed.
      // TransfersService.submit() refuses a revoked plot, but it cannot refuse
      // one that was revoked after approval.
      if (property.status !== 'ISSUED') {
        throw new UnprocessableEntityException(
          `Property ${transfer.propertyId} is ${property.status}, not ISSUED, so the approved ` +
            `transfer for it cannot be published. Reject that transfer request first.`,
        );
      }
      // Only `ownerCommitment` changes — every other leaf field is carried over
      // from the stored row, which is what makes a transfer a transfer and not
      // an edit (D41/§2.4).
      const leaf = await hashRecord(
        toLURRecord({ ...property, ownerCommitment: transfer.newOwnerCommitment }),
      );
      updates.set(Number(transfer.propertyId), leaf);
      newLeaves.set(transfer.propertyId, leaf.toString());
    }

    // Revocation = remove the leaf (D45). The enforcement lives here, not in
    // the on-chain reason list: with no leaf there is no Merkle path, so no
    // circuit can produce a proof for the plot afterwards.
    for (const revocation of revocations) {
      updates.set(Number(revocation.propertyId), null);
    }

    return { updates, newLeaves, before };
  }

  /**
   * The buyers' bundles for this round (D77): one folder per transferred plot,
   * the same four files as an issuance folder, built by the same
   * IssuanceService.buildBundleFiles so the two formats cannot drift apart.
   *
   * Every path comes from the projected overlay, never from the node table:
   * applyStatements has not run yet, so the table still holds the tree as it
   * stood BEFORE this round, and a receipt built from it would not verify
   * against the root that was just signed.
   */
  private async buildArchive(input: {
    changeSetId: number;
    txHash: string | null;
    rootVersion: number;
    overlay: TreeOverlay;
    transfers: { propertyId: string; newOwnerCommitment: string; newOwnerSecret: string | null }[];
    before: Map<string, Property>;
    newLeaves: Map<string, string>;
    publishedAt: Date;
  }): Promise<Buffer> {
    const { issuer, issuedOn } = this.issuance.batchContext();
    const context = {
      rootVersion: input.rootVersion,
      merkleRoot: input.overlay.root,
      transactionHash: input.txHash ?? '',
      contractAddress: this.chain.rootRegistryAddress,
      explorerTxUrlPrefix: this.chain.explorerTxUrlPrefix,
    };

    const entries: ArchiveEntry[] = [];
    for (const transfer of input.transfers) {
      const property = {
        ...input.before.get(transfer.propertyId)!,
        ownerCommitment: transfer.newOwnerCommitment,
      };
      const leaf = BigInt(input.newLeaves.get(transfer.propertyId)!);
      const merkleProof = await this.nodes.proofInOverlay(property, leaf, input.overlay);
      const built = await this.issuance.buildBundleFiles(
        { property, ownerSecret: BigInt(transfer.newOwnerSecret!), merkleProof },
        context,
        issuer,
        issuedOn,
      );
      entries.push({
        propertyId: property.propertyId,
        certificateSerial: property.certificateSerial,
        leaf: leaf.toString(),
        files: built.files,
      });
    }

    return this.archive.build({
      kind: 'changeset',
      batchId: input.changeSetId,
      rootVersion: input.rootVersion,
      txHash: input.txHash,
      publishedAt: input.publishedAt,
      entries,
    });
  }

  /**
   * Abandon a draft. Nothing was ever written to Property, TransferRequest or
   * Revocation — only `connect`ed to this draft — so releasing the relation is
   * enough to return them to `pending()`.
   */
  async discard(id: number): Promise<void> {
    const draft = await this.prisma.changeSet.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      // Anything else is already PUBLISHED or DISCARDED. Relabelling it and
      // detaching transfers/revocations with `set: []` would corrupt the
      // audit trail — the on-chain state and the individual rows stay
      // correct, but the record of which batch published what is destroyed.
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    await this.prisma.changeSet.update({
      where: { id },
      data: { status: 'DISCARDED', transfers: { set: [] }, revocations: { set: [] } },
    });
  }

  /** Every change set, newest first. Summary columns only — never `archiveZip` (D77). */
  async list(): Promise<ChangeSetSummary[]> {
    const rows = await this.prisma.changeSet.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        newRoot: true,
        rootVersion: true,
        txHash: true,
        createdAt: true,
        publishedAt: true,
        archiveExpiresAt: true,
        _count: { select: { transfers: true, revocations: true } },
      },
    });
    return rows.map(({ _count, ...row }) => ({
      ...row,
      transferCount: _count.transfers,
      revocationCount: _count.revocations,
    }));
  }

  /** The buyers' archive, while it still exists. An expired archive is gone for good. */
  async archiveFor(id: number): Promise<{ zip: Buffer; filename: string }> {
    const changeSet = await this.prisma.changeSet.findUnique({
      where: { id },
      select: { archiveZip: true, archiveExpiresAt: true },
    });
    if (!changeSet || !changeSet.archiveZip) {
      throw new NotFoundException(`Change set #${id} has no archive`);
    }
    if (changeSet.archiveExpiresAt && changeSet.archiveExpiresAt.getTime() < Date.now()) {
      await this.prisma.changeSet.update({ where: { id }, data: { archiveZip: null } });
      throw new GoneException(
        `The archive for change set #${id} expired on ${changeSet.archiveExpiresAt.toISOString()}. ` +
          `The buyers' secrets are unrecoverable — the affected plots must be re-issued.`,
      );
    }
    return { zip: Buffer.from(changeSet.archiveZip), filename: `changeset-${id}.zip` };
  }
}
