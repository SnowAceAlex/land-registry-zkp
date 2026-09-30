/**
 * features/resident/verify/lib/receipt-file.ts — the receipt.json the agency tab requires.
 *
 * Shape only, like `lib/proof-file.ts`: the issuer chain itself is `issuer-chain.ts`.
 */

import {
  type CircuitType,
  publicSignalIndex,
} from '@land-registry/blockchain/shared/circuitInputs';
import type { Receipt } from '@land-registry/blockchain/shared/receipt';

export type ReceiptFileErrorCode = 'invalid-json' | 'invalid-shape' | 'property-mismatch';

export class ReceiptFileError extends Error {
  constructor(
    readonly code: ReceiptFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReceiptFileError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

export function parseReceiptFile(text: string): Receipt {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ReceiptFileError('invalid-json', 'receipt.json is not valid JSON');
  }

  // Only the fields this page reads: the issuer block, the contract and the plot.
  if (
    !isRecord(raw) ||
    !isText(raw.contractAddress) ||
    !isText(raw.propertyId) ||
    !isRecord(raw.issuer) ||
    !isText(raw.issuer.ethereumAccount) ||
    !isText(raw.issuer.ethereumAccountSignature) ||
    !isText(raw.issuer.IssuerCertificateChain)
  ) {
    throw new ReceiptFileError(
      'invalid-shape',
      'receipt.json needs contractAddress, propertyId and an issuer block',
    );
  }
  return raw as unknown as Receipt;
}

/** Stops a receipt of another plot from vouching for this proof. */
export function assertReceiptMatchesProof(
  receipt: Receipt,
  circuitType: CircuitType,
  publicSignals: readonly string[],
): void {
  const proven = publicSignals[publicSignalIndex(circuitType, 'propertyId')];
  let same = false;
  try {
    same = BigInt(receipt.propertyId) === BigInt(proven);
  } catch {
    same = false;
  }
  if (!same) {
    throw new ReceiptFileError(
      'property-mismatch',
      `receipt.json is for plot ${receipt.propertyId}, the proof for plot ${proven}`,
    );
  }
}
