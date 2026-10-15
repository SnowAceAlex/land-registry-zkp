import { Injectable } from '@nestjs/common';

import { ZipEntry, ZipService } from './zip.service';

/** How long an archive — and therefore the only copy of its secrets — survives (D42, D77). */
export const ARCHIVE_TTL_DAYS = 7;

export interface ArchiveEntry {
  propertyId: string;
  certificateSerial: string;
  leaf: string;
  /** Set on round archives (D84); absent only on the legacy issuance-batch archive. */
  kind?: 'issued' | 'transferred';
  files: ZipEntry[];
}

/** Legacy issuance-batch archive input; goes with IssuanceBatchService. */
export interface ArchiveInput {
  kind: 'issuance' | 'changeset';
  batchId: number;
  rootVersion: number;
  txHash: string | null;
  publishedAt: Date;
  entries: ArchiveEntry[];
}

export interface RoundArchiveEntry extends ArchiveEntry {
  kind: 'issued' | 'transferred';
}

/** One office's share of a publishing round (D88). */
export interface RoundArchiveInput {
  roundId: number;
  officeCode: string;
  rootVersion: number;
  txHash: string | null;
  publishedAt: Date;
  entries: RoundArchiveEntry[];
}

export const roundArchiveFilename = (roundId: number, officeCode: string): string =>
  `round-${roundId}-${officeCode}.zip`;

/**
 * Packs bundles into one ZIP, one folder per plot plus a manifest.json. The ZIP holds
 * every owner's secret.json, so whoever downloads it holds those secrets (D14 limitation).
 * The TTL limits the server's copy only; a downloaded copy never expires.
 * A "/" in an entry name makes the folder (archiver).
 */
@Injectable()
export class ArchiveService {
  constructor(private readonly zip: ZipService) {}

  async build(input: ArchiveInput): Promise<Buffer> {
    return this.pack(
      {
        kind: input.kind,
        batchId: input.batchId,
        rootVersion: input.rootVersion,
        txHash: input.txHash,
        publishedAt: input.publishedAt.toISOString(),
      },
      input.entries,
    );
  }

  /** D88: the archive of one branch for one round. */
  async buildRound(input: RoundArchiveInput): Promise<Buffer> {
    return this.pack(
      {
        kind: 'round',
        roundId: input.roundId,
        officeCode: input.officeCode,
        rootVersion: input.rootVersion,
        txHash: input.txHash,
        publishedAt: input.publishedAt.toISOString(),
      },
      input.entries,
    );
  }

  private pack(header: Record<string, unknown>, entries: ArchiveEntry[]): Promise<Buffer> {
    const manifest = {
      ...header,
      properties: entries.map((entry) => ({
        propertyId: entry.propertyId,
        certificateSerial: entry.certificateSerial,
        leaf: entry.leaf,
        kind: entry.kind,
      })),
    };
    const files = entries.flatMap((entry) =>
      entry.files.map((file) => ({
        name: `${entry.propertyId}/${file.name}`,
        content: file.content,
      })),
    );
    return this.zip.create([
      ...files,
      { name: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
    ]);
  }
}
