import { Injectable } from '@nestjs/common';
import * as archiver from 'archiver';

/**
 * ZipService
 * ─────────────────────────────────────────────────────────────────────────────
 * Packs an issued bundle into a ZIP held entirely in memory.
 */

export interface ZipEntry {
  name: string;
  content: Buffer | string;
}

@Injectable()
export class ZipService {
  async create(entries: ZipEntry[]): Promise<Buffer> {
    const archive = archiver.create('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
      // A warning here (a skipped entry) means an incomplete bundle, which
      // would be worse to hand out silently than to fail the request.
      archive.on('warning', reject);
    });

    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }
    await archive.finalize();
    await done;

    return Buffer.concat(chunks);
  }
}
