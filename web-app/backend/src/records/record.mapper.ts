import { Property } from '@prisma/client';
import {
  EncumbranceStatus,
  LURRecord,
  OffchainMetadata,
  ReceiptDescriptiveFields,
  TenureType,
  UseType,
  hashOffchainMetadata,
  receiptOffchainMetadata,
} from '@land-registry/blockchain/shared';

/**
 * record.mapper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The only place a Prisma `Property` row is turned into the canonical
 * `LURRecord` (and back). Prisma stores the three enums by NAME for
 * readability; circuits and Poseidon hashing need the NUMERIC values from
 * @land-registry/blockchain/shared. Keeping both directions here means the
 * name↔number correspondence exists once, not at every call site.
 */

// Prisma generates its own string-literal enum types with the same member
// names as the shared numeric enums. Index by name so adding a member on
// either side surfaces as a TypeScript error rather than a silent mismatch.
const USE_TYPE_BY_NAME: Record<Property['useType'], UseType> = {
  RESIDENTIAL: UseType.RESIDENTIAL,
  AGRICULTURAL: UseType.AGRICULTURAL,
  COMMERCIAL: UseType.COMMERCIAL,
  INDUSTRIAL: UseType.INDUSTRIAL,
  FORESTRY: UseType.FORESTRY,
};

const ENCUMBRANCE_BY_NAME: Record<Property['encumbranceStatus'], EncumbranceStatus> = {
  FREE: EncumbranceStatus.FREE,
  MORTGAGED: EncumbranceStatus.MORTGAGED,
  LITIGATED: EncumbranceStatus.LITIGATED,
  RESTRICTED: EncumbranceStatus.RESTRICTED,
};

const TENURE_BY_NAME: Record<Property['tenureType'], TenureType> = {
  PERPETUAL: TenureType.PERPETUAL,
  FIXED_TERM: TenureType.FIXED_TERM,
  PROJECT_LEASEHOLD: TenureType.PROJECT_LEASEHOLD,
};

function invert<Name extends string, Value extends number>(
  byName: Record<Name, Value>,
): Record<Value, Name> {
  const result = {} as Record<Value, Name>;
  for (const [name, value] of Object.entries(byName) as [Name, Value][]) {
    result[value] = name;
  }
  return result;
}

const USE_TYPE_BY_VALUE = invert(USE_TYPE_BY_NAME);
const ENCUMBRANCE_BY_VALUE = invert(ENCUMBRANCE_BY_NAME);
const TENURE_BY_VALUE = invert(TENURE_BY_NAME);

export function useTypeName(value: UseType): Property['useType'] {
  return USE_TYPE_BY_VALUE[value];
}

export function encumbranceStatusName(value: EncumbranceStatus): Property['encumbranceStatus'] {
  return ENCUMBRANCE_BY_VALUE[value];
}

export function tenureTypeName(value: TenureType): Property['tenureType'] {
  return TENURE_BY_VALUE[value];
}

/**
 * Convert a DB row into the canonical LURRecord used for leaf hashing and
 * circuit inputs.
 *
 * @throws if the property has not been issued yet — `ownerCommitment` is set at
 *   issue time (D14), and a record without it has no leaf: including it in the
 *   tree would either need a fabricated commitment or shift every other leaf's
 *   index. Callers must filter to issued properties first.
 */
export function toLURRecord(property: Property): LURRecord {
  if (property.ownerCommitment === null) {
    throw new Error(
      `toLURRecord: property ${property.propertyId} has no ownerCommitment ` +
        `(not issued yet) and cannot be part of the Merkle tree`,
    );
  }

  return {
    propertyId: BigInt(property.propertyId),
    ownerCommitment: BigInt(property.ownerCommitment),
    useType: USE_TYPE_BY_NAME[property.useType],
    validityPeriod: BigInt(property.validityPeriod),
    encumbranceStatus: ENCUMBRANCE_BY_NAME[property.encumbranceStatus],
    tenureType: TENURE_BY_NAME[property.tenureType],
    offchainHash: hashOffchainMetadata(toOffchainMetadata(property)),
  };
}

/**
 * The descriptive certificate fields of a DB row, in the shape `receipt.json`
 * carries them.
 *
 * This is the ONLY place the backend names those ten fields. Both the leaf hash
 * (through {@link toOffchainMetadata}) and the receipt body are derived from it,
 * so the certificate cannot end up describing something other than what the
 * commitment attests — previously the two lists were maintained separately, and
 * a divergence would not throw, it would silently produce a leaf that is not in
 * the tree.
 */
export function toReceiptDescriptiveFields(property: Property): ReceiptDescriptiveFields {
  return {
    landUseCode: property.landUseCode,
    landUserType: property.landUserType ?? null,
    certificateSerial: property.certificateSerial,
    bookEntryNumber: property.bookEntryNumber,
    mapSheetNumber: property.mapSheetNumber ?? null,
    landOrigin: property.landOrigin ?? null,
    address: property.address,
    // Prisma Decimal → JSON number, which is the receipt's wire format. The
    // conversion to the 2dp string the digest needs happens in the shared
    // receiptOffchainMetadata(), so it exists once for every reader.
    area: Number(property.area),
    issuingAuthority: property.issuingAuthority,
    issueDate: property.issueDate.toISOString().slice(0, 10),
  };
}

/** The same fields in the exact shape the shared commitment digest expects. */
export function toOffchainMetadata(property: Property): OffchainMetadata {
  return receiptOffchainMetadata(toReceiptDescriptiveFields(property));
}

/** The 6 on-chain leaf fields as JSON-safe values, for receipt.json (§3.1). */
export function serializeLURRecord(record: LURRecord) {
  return {
    propertyId: record.propertyId.toString(),
    ownerCommitment: record.ownerCommitment.toString(),
    useType: record.useType,
    validityPeriod: record.validityPeriod.toString(),
    encumbranceStatus: record.encumbranceStatus,
    tenureType: record.tenureType,
  };
}
