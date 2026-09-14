/**
 * features/government/transfers/lib/buyer-secret.ts - the buyer's new secret (D51).
 *
 * transfer.circom needs both owners' secrets in one witness, so the buyer's is
 * generated here, in the officer's browser, and never sent anywhere: only its
 * commitment reaches the backend. 31 bytes (248 bits) keeps it below the BN254
 * field modulus — the same bound the backend's issuance secrets use.
 */

import { strToU8, zipSync } from 'fflate';
import type { OwnerSecretFile } from '@land-registry/blockchain/shared';

const SECRET_BYTES = 31;

export function generateOwnerSecret(
  fillRandom: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): bigint {
  const bytes = fillRandom(new Uint8Array(SECRET_BYTES));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/** secret.json, in the exact shape the issuance bundle uses (D31). */
export function ownerSecretFile(propertyId: string, ownerSecret: bigint): OwnerSecretFile {
  return { propertyId, ownerSecret: ownerSecret.toString() };
}

/**
 * The download the buyer takes home: a ZIP holding `<propertyId>/secret.json`.
 *
 * A ZIP rather than a bare secret.json because the inner name must stay exactly
 * `secret.json` for the bundle reader, while a browser saving a second
 * `secret.json` into the same folder renames it `secret (1).json`. The unique
 * outer name avoids that; the folder mirrors the issuance archive (D42), so the
 * buyer's portal can read it together with the receipt ZIP from
 * GET /transfers/:id/bundle.
 */
export function buyerSecretArchive(
  propertyId: string,
  ownerSecret: bigint,
): { bytes: Uint8Array; filename: string } {
  const file = JSON.stringify(ownerSecretFile(propertyId, ownerSecret), null, 2);
  return {
    bytes: zipSync({ [`${propertyId}/secret.json`]: strToU8(file) }),
    filename: `secret-${propertyId}-buyer.zip`,
  };
}
