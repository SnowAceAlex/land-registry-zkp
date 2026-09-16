import { describe, expect, it } from 'vitest';

import { forgetDraftTx, recallDraftTx, rememberDraftTx } from './draft-tx-store';

const HASH = `0x${'ab'.repeat(32)}` as const;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

describe('draft-tx-store (D53)', () => {
  it('recalls the hash signed for the same draft', () => {
    const storage = memoryStorage();

    rememberDraftTx(storage, 'issuance', 7, HASH);

    expect(recallDraftTx(storage, 'issuance', 7)).toBe(HASH);
    expect(recallDraftTx(storage, 'changeset', 7)).toBeNull();
    expect(recallDraftTx(storage, 'issuance', 8)).toBeNull();
  });

  it('forgets it once the draft is confirmed or discarded', () => {
    const storage = memoryStorage();
    rememberDraftTx(storage, 'changeset', 9, HASH);

    forgetDraftTx(storage, 'changeset', 9);

    expect(recallDraftTx(storage, 'changeset', 9)).toBeNull();
  });

  it('ignores a stored value that is not a transaction hash', () => {
    // confirm() would reject a malformed label with a 400; a missing label is fine.
    const storage = memoryStorage();
    storage.setItem('land-registry.draft-tx.issuance.7', 'not-a-hash');

    expect(recallDraftTx(storage, 'issuance', 7)).toBeNull();
  });

  it('never throws when storage is unavailable (private mode)', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };

    expect(() => rememberDraftTx(broken, 'issuance', 7, HASH)).not.toThrow();
    expect(recallDraftTx(broken, 'issuance', 7)).toBeNull();
    expect(() => forgetDraftTx(broken, 'issuance', 7)).not.toThrow();
  });
});
