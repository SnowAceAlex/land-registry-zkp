/**
 * lib/disclosure.ts - what a proof reveals, and what it never reveals.
 *
 * This is the thesis's central claim made legible. A verifier is handed four
 * or five numbers; without being told, they cannot tell whether the silence
 * about the expiry date is deliberate or accidental. Saying both halves out
 * loud — proven, and never revealed — is the whole point of the system, and a
 * reader will not infer it.
 *
 * Shared by UC-5, which shows it before the owner hands the file over, and
 * UC-6, which shows it to the person receiving it (D66). Sibling features
 * cannot import each other, so it lives here.
 *
 * The disclosed side comes from `describePublicSignals` (D21/D25) and the
 * withheld side is DERIVED — `LEAF_FIELD_ORDER` minus the signals this circuit
 * publishes — so adding an eighth leaf field will widen this list on its own
 * instead of leaving a stale one behind (D67).
 *
 * Imported by subpath, not through the shared barrel: the barrel re-exports
 * merkleTree.ts, whose circomlibjs import would put ~3 MB of cryptography into
 * the verify page, which hashes nothing.
 */

import { LEAF_FIELD_ORDER } from '@land-registry/blockchain/shared/leafFields';
import {
  PUBLIC_SIGNAL_ORDER,
  type CircuitType,
  describePublicSignals,
} from '@land-registry/blockchain/shared/circuitInputs';

/** A named public signal and its value. */
export interface DisclosedSignal {
  /** The circuit's own signal name — also the residentSignals dictionary key. */
  name: string;
  value: string;
}

export interface Disclosure {
  disclosed: DisclosedSignal[];
  /** Names of things this proof establishes nothing about, for the reader. */
  withheld: string[];
}

/**
 * Two private inputs that are not leaf fields and so cannot be derived from
 * `LEAF_FIELD_ORDER`, but are exactly what a reader worries about.
 *
 * `offchainHash` IS a leaf field, but naming it to a resident would mean
 * nothing — it is replaced by what it commits to, the descriptive certificate
 * fields (address, area, landUseCode...), under its own label.
 */
const ALWAYS_WITHHELD = ['ownerSecret', 'offchainMetadata'] as const;
const OFFCHAIN_HASH_FIELD = 'offchainHash';

export function disclosureFor(
  circuitType: CircuitType,
  publicSignals: readonly string[],
): Disclosure {
  const expected = PUBLIC_SIGNAL_ORDER[circuitType].length;
  if (publicSignals.length !== expected) {
    throw new Error(
      `A ${circuitType} proof has ${expected} public signals, got ${publicSignals.length}`,
    );
  }

  const described = describePublicSignals(circuitType, publicSignals);
  const disclosed = PUBLIC_SIGNAL_ORDER[circuitType].map((name) => ({
    name,
    value: described[name],
  }));

  const published = new Set<string>(PUBLIC_SIGNAL_ORDER[circuitType]);
  const withheld: string[] = LEAF_FIELD_ORDER.filter((field) => !published.has(field)).map(
    (field): string => (field === OFFCHAIN_HASH_FIELD ? 'offchainMetadata' : field),
  );

  for (const name of ALWAYS_WITHHELD) {
    if (!withheld.includes(name)) withheld.push(name);
  }

  return { disclosed, withheld };
}
