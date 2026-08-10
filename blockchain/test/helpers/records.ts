/**
 * test/helpers/records.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixtures for circuit tests.
 *
 * scripts/tools/generateMockData.ts randomises tenureType, encumbranceStatus and
 * validityPeriod, which is right for tree-shaped tests but useless when a test
 * needs to hit one specific branch ("an expired FIXED_TERM title", "a
 * MORTGAGED title"). These helpers build a record with exactly the fields under
 * test, then bury it in a tree of random filler records so the Merkle path is
 * realistic rather than a degenerate single-leaf path.
 */

import { EncumbranceStatus, LURRecord, TenureType, UseType } from '../../shared/types';
import {
  buildTree,
  generateMerkleProof,
  poseidonHash,
  LURMerkleTree,
} from '../../shared/merkleTree';
import { MerkleProofData } from '../../shared/types';
import { generateMockRecords } from '../../scripts/tools/generateMockData';

export const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

/** propertyId reserved for the record under test; generateMockRecords uses 1..N. */
const SUBJECT_PROPERTY_ID = 9_001n;

/** An arbitrary but fixed secret so tests are reproducible. */
export const SUBJECT_SECRET = 123_456_789_012_345_678_901n;
/** A different secret, for "wrong owner" and "new owner" cases. */
export const OTHER_SECRET = 987_654_321_098_765_432_109n;

/**
 * Fixed commitment to the descriptive certificate fields. Circuit tests are
 * about the legal predicates, not the metadata digest, so they pin one value —
 * a varying digest would change every leaf without testing anything new.
 */
export const DEFAULT_OFFCHAIN_HASH = 555_666_777_888_999n;

export interface MakeRecordOptions {
  secret?: bigint;
  propertyId?: bigint;
  useType?: UseType;
  validityPeriod?: bigint;
  encumbranceStatus?: EncumbranceStatus;
  tenureType?: TenureType;
  offchainHash?: bigint;
}

/**
 * Build a single LUR record whose ownerCommitment is the Poseidon commitment of
 * `secret`. Defaults to a clean, non-expiring, 10-years-left residential title.
 */
export async function makeRecord(
  now: bigint,
  options: MakeRecordOptions = {},
): Promise<{ record: LURRecord; secret: bigint }> {
  const secret = options.secret ?? SUBJECT_SECRET;
  const ownerCommitment = await poseidonHash([secret]);

  const tenureType = options.tenureType ?? TenureType.FIXED_TERM;
  const validityPeriod =
    options.validityPeriod ??
    (tenureType === TenureType.PERPETUAL ? 0n : now + 10n * SECONDS_PER_YEAR);

  return {
    secret,
    record: {
      propertyId: options.propertyId ?? SUBJECT_PROPERTY_ID,
      ownerCommitment,
      useType: options.useType ?? UseType.RESIDENTIAL,
      validityPeriod,
      encumbranceStatus: options.encumbranceStatus ?? EncumbranceStatus.FREE,
      tenureType,
      offchainHash: options.offchainHash ?? DEFAULT_OFFCHAIN_HASH,
    },
  };
}

export interface SubjectFixture {
  record: LURRecord;
  secret: bigint;
  tree: LURMerkleTree;
  proof: MerkleProofData;
  /** All records in the tree, subject included — needed to rebuild for transfer. */
  allRecords: LURRecord[];
}

/**
 * Place `record` in a tree alongside `fillerCount` random records and return the
 * record's inclusion proof. The subject sits in the middle so its Merkle path
 * exercises both left- and right-child steps.
 */
export async function placeInTree(
  record: LURRecord,
  secret: bigint,
  fillerCount = 6,
): Promise<SubjectFixture> {
  const { records: filler } = await generateMockRecords(fillerCount);
  const half = Math.floor(filler.length / 2);
  const allRecords = [...filler.slice(0, half), record, ...filler.slice(half)];

  const tree = await buildTree(allRecords);
  const proof = await generateMerkleProof(tree, record);

  return { record, secret, tree, proof, allRecords };
}

/** Convenience: makeRecord + placeInTree in one call. */
export async function makeSubject(
  now: bigint,
  options: MakeRecordOptions = {},
  fillerCount = 6,
): Promise<SubjectFixture> {
  const { record, secret } = await makeRecord(now, options);
  return placeInTree(record, secret, fillerCount);
}
