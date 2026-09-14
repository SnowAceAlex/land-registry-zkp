/**
 * features/government/publishing/draft-tx-store.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Remembers the publish transaction hash of a draft across a reload, so a
 * confirm() made after reopening the tab can still carry it.
 *
 * The hash is a LABEL, never evidence (D43): confirm() re-reads latestRoot from
 * the chain and decides on that alone. Losing this value costs a history row
 * its block-explorer link, nothing more — which is why every failure here is
 * swallowed rather than surfaced. sessionStorage, like the portal key: it dies
 * with the tab on a shared counter machine.
 */

import type { DraftKind } from '../api/types';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const keyFor = (kind: DraftKind, id: number) => `land-registry.draft-tx.${kind}.${id}`;

export function rememberDraftTx(storage: StorageLike, kind: DraftKind, id: number, hash: string): void {
  try {
    storage.setItem(keyFor(kind, id), hash);
  } catch {
    /* storage unavailable — the hash was only ever a label */
  }
}

export function recallDraftTx(storage: StorageLike, kind: DraftKind, id: number): `0x${string}` | null {
  try {
    const value = storage.getItem(keyFor(kind, id));
    return value && TX_HASH.test(value) ? (value as `0x${string}`) : null;
  } catch {
    return null;
  }
}

export function forgetDraftTx(storage: StorageLike, kind: DraftKind, id: number): void {
  try {
    storage.removeItem(keyFor(kind, id));
  } catch {
    /* nothing to clean up */
  }
}
