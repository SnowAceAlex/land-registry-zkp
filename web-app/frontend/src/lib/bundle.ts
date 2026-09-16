/**
 * lib/bundle.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Read an owner's bundle — `receipt.json` + `secret.json` (D31) — from what a
 * person hands the browser: the per-plot ZIP, the plot's folder from the batch
 * archive (D42) zipped up, or the two JSON files selected together.
 *
 * Shared by the government transfer counter (Phase 8, the seller's bundle) and
 * the resident proof page (Phase 9). Everything happens in memory: the secret
 * is never written anywhere and never leaves the page.
 *
 * Only the SHAPE is checked here. Whether the receipt is genuine (its leaf
 * recomputes from its record, the secret matches its commitment) is the
 * caller's check, through blockchain/shared — this module does no crypto.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { OwnerSecretFile, Receipt } from '@land-registry/blockchain/shared';

export interface OwnerBundle {
  receipt: Receipt;
  secret: OwnerSecretFile;
}

export type BundleErrorCode =
  | 'no-files'
  | 'missing-receipt'
  | 'missing-secret'
  | 'multiple-properties'
  | 'invalid-json'
  | 'invalid-shape'
  | 'property-mismatch';

export class BundleError extends Error {
  constructor(
    readonly code: BundleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BundleError';
  }
}

export interface BundleEntry {
  name: string;
  text: string;
}

const DECIMAL = /^\d+$/;

function basename(name: string): string {
  return name.split('/').pop()?.toLowerCase() ?? '';
}

function parseJson(entry: BundleEntry): unknown {
  try {
    return JSON.parse(entry.text);
  } catch {
    throw new BundleError('invalid-json', `${entry.name} is not valid JSON`);
  }
}

function isReceipt(value: unknown): value is Receipt {
  const receipt = value as Receipt;
  return (
    !!receipt &&
    typeof receipt.propertyId === 'string' &&
    DECIMAL.test(receipt.propertyId) &&
    typeof receipt.leaf === 'string' &&
    typeof receipt.record === 'object' &&
    receipt.record !== null &&
    typeof receipt.record.ownerCommitment === 'string' &&
    Array.isArray(receipt.merkleProof?.siblings)
  );
}

function isSecret(value: unknown): value is OwnerSecretFile {
  const secret = value as OwnerSecretFile;
  return (
    !!secret &&
    typeof secret.propertyId === 'string' &&
    typeof secret.ownerSecret === 'string' &&
    DECIMAL.test(secret.ownerSecret)
  );
}

/** Pick the receipt and the secret out of a flat list of named text files. */
export function parseBundleEntries(entries: BundleEntry[]): OwnerBundle {
  const receipts = entries.filter((entry) => basename(entry.name) === 'receipt.json');
  const secrets = entries.filter((entry) => basename(entry.name) === 'secret.json');

  // A whole batch archive holds one folder per plot. Picking the first would
  // silently transfer the wrong plot, so refuse and ask for the one folder.
  if (receipts.length > 1 || secrets.length > 1) {
    throw new BundleError(
      'multiple-properties',
      'The selection holds more than one plot; select a single plot folder or ZIP',
    );
  }
  if (receipts.length === 0) throw new BundleError('missing-receipt', 'receipt.json is missing');
  if (secrets.length === 0) throw new BundleError('missing-secret', 'secret.json is missing');

  const receipt = parseJson(receipts[0]);
  const secret = parseJson(secrets[0]);
  if (!isReceipt(receipt)) {
    throw new BundleError('invalid-shape', `${receipts[0].name} is not a registry receipt`);
  }
  if (!isSecret(secret)) {
    throw new BundleError('invalid-shape', `${secrets[0].name} is not an owner secret file`);
  }
  if (receipt.propertyId !== secret.propertyId) {
    throw new BundleError(
      'property-mismatch',
      `receipt.json is for plot ${receipt.propertyId} but secret.json is for plot ${secret.propertyId}`,
    );
  }
  return { receipt, secret };
}

function isZip(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip');
}

/** Read the selected files (ZIPs are expanded in memory) and parse the bundle. */
export async function readBundleFiles(files: File[]): Promise<OwnerBundle> {
  if (files.length === 0) throw new BundleError('no-files', 'No file was selected');

  const entries: BundleEntry[] = [];
  for (const file of files) {
    if (isZip(file)) {
      const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        // Only the two JSON files matter; skip decompressing the PDF.
        filter: (entry) => basename(entry.name).endsWith('.json'),
      });
      for (const [name, data] of Object.entries(unzipped)) {
        entries.push({ name, text: strFromU8(data) });
      }
    } else {
      entries.push({ name: file.name, text: await file.text() });
    }
  }
  return parseBundleEntries(entries);
}
