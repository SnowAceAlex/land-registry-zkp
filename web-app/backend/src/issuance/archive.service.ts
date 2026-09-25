import { Injectable } from '@nestjs/common';

import { ZipEntry, ZipService } from './zip.service';

/** How long an archive — and therefore the only copy of its secrets — survives (D42, D77). */
export const ARCHIVE_TTL_DAYS = 7;

export interface ArchiveEntry {
  propertyId: string;
  certificateSerial: string;
  leaf: string;
  files: ZipEntry[];
}

export interface ArchiveInput {
  /** Which round produced it: an issuance batch (D42) or a change set's transfers (D77). */
  kind: 'issuance' | 'changeset';
  batchId: number;
  rootVersion: number;
  txHash: string | null;
  publishedAt: Date;
  entries: ArchiveEntry[];
}

/**
 * ArchiveService — the batch archive of D42.
 *
 * One ZIP for a whole issuance round, one folder per plot, handed to the
 * authority and distributed to owners outside the system. This replaces the
 * per-plot one-time claim link of D34.
 *
 * Since D77 a change set's transfers use it too — one folder per transferred
 * plot, the same four files — so a buyer's bundle and an issued owner's are
 * indistinguishable.
 *
 * The archive contains every owner's secret.json, so the officer holds a copy of
 * all of them until the TTL expires. That is a real privacy cost and it belongs
 * in the thesis Limitations next to D14 — it is not hidden here.
 *
 * ZipService needs no change: archiver treats an entry name as a path, so a "/"
 * in it creates the folder.
 */
@Injectable()
export class ArchiveService {
  constructor(private readonly zip: ZipService) {}

  async build(input: ArchiveInput): Promise<Buffer> {
    const manifest = {
      kind: input.kind,
      batchId: input.batchId,
      rootVersion: input.rootVersion,
      txHash: input.txHash,
      publishedAt: input.publishedAt.toISOString(),
      properties: input.entries.map((entry) => ({
        propertyId: entry.propertyId,
        certificateSerial: entry.certificateSerial,
        leaf: entry.leaf,
      })),
    };

    const files = input.entries.flatMap((entry) =>
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
