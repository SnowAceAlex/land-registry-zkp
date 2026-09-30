import { describe, expect, it } from 'vitest';

import { type FreezeStepInput, nextFreezeStep } from './next-freeze-step';

const ready: FreezeStepInput = {
  targetKnown: true,
  walletConnected: true,
  walletChainId: 31337,
  expectedChainId: 31337,
  hasRole: true,
};

describe('nextFreezeStep (D80)', () => {
  it('signs when everything is in place', () => {
    expect(nextFreezeStep(ready)).toBe('sign');
  });

  it('waits for the registry status before anything else', () => {
    expect(nextFreezeStep({ ...ready, targetKnown: false, walletConnected: false })).toBe('loading');
  });

  it('asks for the wallet, then the right chain, then the role — in that order', () => {
    expect(nextFreezeStep({ ...ready, walletConnected: false, walletChainId: 1 })).toBe('connect');
    expect(nextFreezeStep({ ...ready, walletChainId: 1, hasRole: false })).toBe('wrongChain');
    expect(nextFreezeStep({ ...ready, hasRole: undefined })).toBe('loading');
    expect(nextFreezeStep({ ...ready, hasRole: false })).toBe('noRole');
  });
});
