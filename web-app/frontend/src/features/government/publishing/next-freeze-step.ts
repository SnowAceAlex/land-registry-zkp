// The wallet half of nextDraftStep, without the draft (D80) — a freeze has no
// confirm step, since the caller that needs it reads frozenOwner from chain.

export type FreezeStepKind = 'loading' | 'connect' | 'wrongChain' | 'noRole' | 'sign';

export interface FreezeStepInput {
  /** GET /government/status has answered with the registry address and chain. */
  targetKnown: boolean;
  walletConnected: boolean;
  walletChainId: number | undefined;
  expectedChainId: number | undefined;
  /** `undefined` until the role check has answered. */
  hasRole: boolean | undefined;
}

export function nextFreezeStep(input: FreezeStepInput): FreezeStepKind {
  if (!input.targetKnown) return 'loading';
  if (!input.walletConnected) return 'connect';
  if (input.walletChainId !== input.expectedChainId) return 'wrongChain';
  if (input.hasRole === undefined) return 'loading';
  if (!input.hasRole) return 'noRole';
  return 'sign';
}
