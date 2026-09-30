import { describe, expect, it } from 'vitest';

import { readFrozenOwner } from './registry-reads';

const REGISTRY = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

/** A PublicClient whose one readContract answers `value`. */
function clientReturning(value: bigint) {
  return { readContract: async () => value } as never;
}

describe('readFrozenOwner (D79)', () => {
  it('reads the zero sentinel as "not frozen"', async () => {
    await expect(readFrozenOwner(clientReturning(0n), REGISTRY, 1001n)).resolves.toBeNull();
  });

  it('returns a frozen commitment as the decimal string publicSignals use', async () => {
    const commitment = 5677530015593700534173836181788122415198283309363871298832210090950018556857n;
    await expect(readFrozenOwner(clientReturning(commitment), REGISTRY, 1001n)).resolves.toBe(
      commitment.toString(),
    );
  });
});
