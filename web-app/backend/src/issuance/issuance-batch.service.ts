import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DraftStatus, IssuanceBatch, Property } from '@prisma/client';
import { hashRecord } from '@land-registry/blockchain/shared';

import { ArchiveEntry, ArchiveService } from './archive.service';
import { ChainService } from '../chain/chain.service';
import { DraftLockService } from '../common/draft-lock.service';
import { RootService } from '../government/root.service';
import { PropertyEventService } from '../history/property-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { NodeStoreService } from '../tree/node-store.service';
import { sortByPropertyId } from '../tree/tree.service';
import { toLURRecord } from '../records/record.mapper';
import { IssuanceService } from './issuance.service';

/** How long the batch archive — and therefore the only copy of the secrets — survives. */
const ARCHIVE_TTL_DAYS = 7;

/** Summary row for `list()` — deliberately excludes `draftSecrets` and `archiveZip`. */
export interface IssuanceBatchSummary {
  id: number;
  status: DraftStatus;
  newRoot: string;
  rootVersion: number | null;
  txHash: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archiveExpiresAt: Date | null;
  propertyCount: number;
}

/**
 * What a portal needs to resume an open issuance draft (D53): enough to show
 * the round and ask the wallet to sign `newRoot` again. Never the secrets —
 * they stay in `draftSecrets` until confirm() packs them into the archive.
 */
export interface IssuanceDraftDetail {
  kind: 'issuance';
  id: number;
  newRoot: string;
  createdAt: Date;
  propertyIds: string[];
}

/**
 * IssuanceBatchService — issuance as a durable two-phase operation (D43).
 *
 * The old `issueBatch` published the root and then wrote the DB, because the
 * reverse order risked leaving a property holding an `ownerCommitment` whose
 * secret existed nowhere — permanently unprovable. Metamask signing (D43) makes
 * "publish first" impossible from the backend, so the ordering is replaced by a
 * stronger property: a DRAFT holds the secrets and the projected root but
 * touches no `Property` row at all. Nothing is half-applied, ever. A crash
 * between signing and confirming loses nothing, because the draft is on disk —
 * the old flow lost the whole batch if `publishRoot` timed out.
 *
 * `createDraft()` deliberately does not populate the `IssuanceBatch.properties`
 * relation either — that relation lives on `Property.issuanceBatchId`, so
 * setting it (even via a Prisma nested `connect`) would itself be a write to
 * `Property`, one line away from the very bug this design exists to prevent.
 * The properties in a round are tracked by the keys of `draftSecrets` until
 * `confirm()` writes `issuanceBatchId` for real — so the relation only ever
 * reflects properties a batch actually issued, never ones merely drafted.
 */
@Injectable()
export class IssuanceBatchService {
  private readonly logger = new Logger(IssuanceBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeStoreService,
    private readonly issuance: IssuanceService,
    private readonly chain: ChainService,
    private readonly roots: RootService,
    private readonly lock: DraftLockService,
    private readonly events: PropertyEventService,
    private readonly archive: ArchiveService,
  ) {}

  /**
   * Every issuance round, newest first. Summary columns only: never
   * `draftSecrets` (secret material, D14) or `archiveZip` (megabytes of ZIP,
   * D42) — a caller that wants the archive itself uses `archiveFor(id)`.
   * `propertyCount` comes from Prisma's `_count`, a single aggregate the
   * database computes alongside the row rather than a second round trip.
   */
  async list(): Promise<IssuanceBatchSummary[]> {
    const batches = await this.prisma.issuanceBatch.findMany({
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
        _count: { select: { properties: true } },
      },
    });

    return batches.map(({ _count, ...batch }) => ({
      ...batch,
      propertyCount: _count.properties,
    }));
  }

  /**
   * Phase 1 — generate secrets, project the tree, store everything as a draft.
   * `Property` is deliberately left untouched until confirm().
   */
  async createDraft(propertyIds: string[]): Promise<IssuanceDraftDetail> {
    await this.lock.assertNoOpenDraft();

    const batch = await this.loadIssuable(propertyIds);

    // Secrets exist only here and inside the bundles built at confirm time (D14).
    const secrets: Record<string, string> = {};
    const withCommitments: Property[] = [];
    for (const property of batch) {
      const ownerSecret = this.issuance.generateOwnerSecret();
      const ownerCommitment = await this.issuance.commitmentFor(ownerSecret);
      secrets[property.propertyId] = ownerSecret.toString();
      withCommitments.push({ ...property, ownerCommitment: ownerCommitment.toString() });
    }

    // Project the new leaves onto the stored tree (D72). Only this batch is
    // hashed: the plots already in the registry are untouched, and their nodes
    // are read on the way up rather than rebuilt.
    const overlay = await this.nodes.projectRoot(await this.leafUpdatesFor(withCommitments));

    // No relation `connect` here on purpose — see the class doc. `draftSecrets`
    // is the only place this round's membership is recorded until confirm().
    const draft = await this.prisma.issuanceBatch.create({
      data: {
        status: 'DRAFT',
        newRoot: overlay.root.toString(),
        draftSecrets: secrets,
      },
    });

    this.logger.log(
      `issuance draft #${draft.id}: ${batch.length} propert(ies), projected root ${overlay.root}`,
    );

    return this.toDraftDetail(draft);
  }

  /**
   * An open draft as the portal sees it (D53) — the same shape createDraft()
   * returned, rebuilt from the stored row. This is how a session that lost
   * that response (a closed tab, a crash between signing and confirming)
   * finds the root it was asked to sign.
   */
  async draftDetail(id: number): Promise<IssuanceDraftDetail> {
    const draft = await this.prisma.issuanceBatch.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException(`Issuance batch #${id} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`Issuance batch #${id} is already ${draft.status}`);
    }
    return this.toDraftDetail(draft);
  }

  /**
   * One mapping for both createDraft() and draftDetail(). The draft's
   * membership is the key set of `draftSecrets` (see the class doc), sorted
   * numerically: JSON keeps insertion order and "10" sorts before "9" as a
   * string, so an unsorted list would reorder itself between the two calls.
   */
  private toDraftDetail(
    draft: Pick<IssuanceBatch, 'id' | 'newRoot' | 'createdAt' | 'draftSecrets'>,
  ): IssuanceDraftDetail {
    const secrets = (draft.draftSecrets ?? {}) as Record<string, string>;
    return {
      kind: 'issuance',
      id: draft.id,
      newRoot: draft.newRoot,
      createdAt: draft.createdAt,
      propertyIds: sortByPropertyId(Object.keys(secrets).map((propertyId) => ({ propertyId }))).map(
        (row) => row.propertyId,
      ),
    };
  }

  /**
   * Phase 2 — the officer has signed. Verify against the CHAIN, not against
   * anything the caller says, then apply everything in one transaction.
   */
  async confirm(
    id: number,
    txHash?: string,
  ): Promise<{ id: number; rootVersion: number; txHash: string | null; propertyIds: string[] }> {
    const draft = await this.prisma.issuanceBatch.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException(`Issuance batch #${id} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`Issuance batch #${id} is already ${draft.status}`);
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

    const latestRoot = await this.chain.getLatestRoot();
    if (latestRoot.toString() !== draft.newRoot) {
      throw new UnprocessableEntityException(
        `On-chain latestRoot is ${latestRoot}, but this draft projects ${draft.newRoot}. ` +
          `The publish transaction has not been mined, or a different root was published.`,
      );
    }
    const rootVersion = await this.chain.getRootVersion();

    // `Property` was never touched by createDraft(), so the draft's own
    // secrets — not the `properties` relation — are the source of truth for
    // which properties this round covers.
    const secrets = (draft.draftSecrets ?? {}) as unknown as Record<string, string>;
    const draftPropertyIds = Object.keys(secrets);

    const properties = await this.prisma.property.findMany({
      where: { propertyId: { in: draftPropertyIds } },
    });
    if (properties.length !== draftPropertyIds.length) {
      const found = new Set(properties.map((property) => property.propertyId));
      const missing = draftPropertyIds.filter((propertyId) => !found.has(propertyId));
      throw new UnprocessableEntityException(
        `Propert(y/ies) ${missing.join(', ')} referenced by draft #${id} no longer exist. ` +
          `Discard this draft and start again.`,
      );
    }

    const withCommitments: Property[] = [];
    for (const property of properties) {
      const ownerSecret = BigInt(secrets[property.propertyId]);
      const ownerCommitment = await this.issuance.commitmentFor(ownerSecret);
      withCommitments.push({ ...property, ownerCommitment: ownerCommitment.toString() });
    }

    const updates = await this.leafUpdatesFor(withCommitments);
    const overlay = await this.nodes.projectRoot(updates);

    // Paranoia that has already paid for itself once: if the re-projected root
    // no longer matches the signed one, something changed underneath the draft
    // and applying it would corrupt the registry.
    if (overlay.root.toString() !== draft.newRoot) {
      throw new UnprocessableEntityException(
        `Reprojected root ${overlay.root} no longer matches the signed root ${draft.newRoot}. ` +
          `Discard this draft and start again.`,
      );
    }

    // One issuer block + timestamp for the whole batch, and the per-property
    // bundle files that both the archive and the history rows are built from —
    // one loop, one source of truth for each leaf (D42).
    const { issuer, issuedOn } = this.issuance.batchContext();
    const context = {
      rootVersion,
      merkleRoot: overlay.root,
      transactionHash: draft.txHash ?? '',
      contractAddress: this.chain.rootRegistryAddress,
      explorerTxUrlPrefix: this.chain.explorerTxUrlPrefix,
    };

    const archiveEntries: ArchiveEntry[] = [];
    for (const property of withCommitments) {
      // The proof MUST come from the projected tree: `applyStatements` below
      // has not run yet, so reading the node table directly would hand back the
      // path of the tree as it stood BEFORE this batch — and the bundle would
      // not verify against the root that was just signed.
      const merkleProof = await this.nodes.proofInOverlay(
        property,
        updates.get(Number(property.propertyId))!,
        overlay,
      );
      const built = await this.issuance.buildBundleFiles(
        { property, ownerSecret: BigInt(secrets[property.propertyId]), merkleProof },
        context,
        issuer,
        issuedOn,
      );
      archiveEntries.push({
        propertyId: property.propertyId,
        certificateSerial: property.certificateSerial,
        leaf: merkleProof.leaf.toString(),
        files: built.files,
      });
    }

    const issuedAt = new Date();
    const archiveExpiresAt = new Date(issuedAt.getTime() + ARCHIVE_TTL_DAYS * 24 * 60 * 60 * 1000);

    // Built outside the transaction (it's pure computation over data already in
    // hand) but persisted inside it, atomically with the write that retires
    // draftSecrets — see the comment on that write below.
    const archiveZip = await this.archive.build({
      batchId: draft.id,
      rootVersion,
      txHash: draft.txHash,
      publishedAt: issuedAt,
      entries: archiveEntries,
    });

    try {
      await this.prisma.$transaction([
        ...withCommitments.map((property) =>
          this.prisma.property.update({
            where: { propertyId: property.propertyId },
            data: {
              ownerCommitment: property.ownerCommitment,
              status: 'ISSUED',
              leaf: updates.get(Number(property.propertyId))!.toString(),
              rootVersion,
              issuedAt,
              issuanceBatchId: draft.id,
            },
          }),
        ),
        this.roots.recordRootStatement({
          root: overlay.root,
          version: rootVersion,
          txHash: draft.txHash ?? '',
        }),
        // O(k·TREE_DEPTH) nodes, not the whole registry (D72). Every owner
        // outside this batch needs no write: their proof is read from this same
        // table the moment they ask for it.
        ...this.nodes.applyStatements(overlay),
        ...this.events.issuedStatements(
          archiveEntries.map((entry) => ({
            propertyId: entry.propertyId,
            ownerCommitment: withCommitments.find((p) => p.propertyId === entry.propertyId)!
              .ownerCommitment!,
            leaf: entry.leaf,
          })),
          { rootVersion, txHash: draft.txHash },
        ),
        this.prisma.issuanceBatch.update({
          where: { id: draft.id },
          data: {
            status: 'PUBLISHED',
            rootVersion,
            publishedAt: issuedAt,
            archiveExpiresAt,
            // Buffer IS a Uint8Array at runtime; the cast is only needed because
            // @types/node types it generic over ArrayBufferLike (which admits
            // SharedArrayBuffer) while Prisma's generated Bytes field is typed
            // over the narrower ArrayBuffer.
            archiveZip: archiveZip as Uint8Array<ArrayBuffer>,
            // The archive built above is now the copy of record for every
            // secret in this batch (D42), so the draft's own copy is redundant.
            // This must stay in the SAME update as archiveZip: nulling it in a
            // write that could commit without the archive would strand the
            // batch's properties — commitment on-chain and in the DB, but no
            // surviving copy of the secret that proves it. See ArchiveService's
            // doc comment for the (deliberate, documented) cost of keeping it at
            // all: the officer holds every owner's secret.json until the TTL.
            draftSecrets: null,
            txHash: draft.txHash,
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

    this.logger.log(`issuance batch #${draft.id} confirmed at root version ${rootVersion}`);

    return {
      id: draft.id,
      rootVersion,
      txHash: draft.txHash,
      propertyIds: withCommitments.map((property) => property.propertyId),
    };
  }

  /** The archive, while it still exists. An expired archive is gone for good. */
  async archiveFor(id: number): Promise<{ zip: Buffer; filename: string }> {
    const batch = await this.prisma.issuanceBatch.findUnique({ where: { id } });
    if (!batch || !batch.archiveZip) {
      throw new NotFoundException(`Issuance batch #${id} has no archive`);
    }
    if (batch.archiveExpiresAt && batch.archiveExpiresAt.getTime() < Date.now()) {
      await this.prisma.issuanceBatch.update({ where: { id }, data: { archiveZip: null } });
      throw new GoneException(
        `The archive for batch #${id} expired on ${batch.archiveExpiresAt.toISOString()}. ` +
          `The owner secrets are unrecoverable — affected properties must be re-issued.`,
      );
    }
    return { zip: Buffer.from(batch.archiveZip), filename: `batch-${id}.zip` };
  }

  /** Abandon a draft. The secrets die with it; the properties were never touched. */
  async discard(id: number): Promise<void> {
    const draft = await this.prisma.issuanceBatch.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException(`Issuance batch #${id} not found`);
    if (draft.status !== 'DRAFT') {
      // Anything else is already PUBLISHED or DISCARDED. Relabelling it and
      // clearing draftSecrets again would corrupt the audit trail — the
      // on-chain state and the properties stay correct, but the record of
      // which batch issued what is destroyed.
      throw new ConflictException(`Issuance batch #${id} is already ${draft.status}`);
    }

    await this.prisma.issuanceBatch.update({
      where: { id },
      data: { status: 'DISCARDED', draftSecrets: null },
    });
  }

  /**
   * The leaf each plot in this batch will occupy, keyed by its slot (D41).
   *
   * Issuance only ever ADDS leaves, so there is no `null` here — unlike a change
   * set, which removes one per revocation. The records carry the commitments
   * generated for this round, so the hash is of the plot as it will be once the
   * round is confirmed.
   */
  private async leafUpdatesFor(properties: Property[]): Promise<Map<number, bigint | null>> {
    const updates = new Map<number, bigint | null>();
    for (const property of properties) {
      updates.set(Number(property.propertyId), await hashRecord(toLURRecord(property)));
    }
    return updates;
  }

  private async loadIssuable(propertyIds: string[]): Promise<Property[]> {
    const properties = await this.prisma.property.findMany({
      where: { propertyId: { in: propertyIds } },
    });

    const missing = propertyIds.filter(
      (id) => !properties.some((property) => property.propertyId === id),
    );
    if (missing.length > 0) {
      throw new NotFoundException(`Unknown propertyId(s): ${missing.join(', ')}`);
    }

    const alreadyIssued = properties.filter((property) => property.status !== 'IMPORTED');
    if (alreadyIssued.length > 0) {
      throw new ConflictException(
        `Already issued or revoked: ${alreadyIssued.map((p) => p.propertyId).join(', ')}`,
      );
    }

    return properties;
  }
}
