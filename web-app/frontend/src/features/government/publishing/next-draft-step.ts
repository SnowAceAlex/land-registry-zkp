/**
 * features/government/publishing/next-draft-step.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The one decision both publishing screens (UC-1 issuance, UC-4 change sets)
 * make on every render: what can the officer do with the draft right now?
 *
 * It is a pure function of five facts so the resume path of D43/D53 is
 * testable without a browser, a wallet or a chain:
 *
 *   - the open draft (D44 allows one, across both kinds);
 *   - the chain's latestRoot — equal to the draft's root means the signature
 *     already landed (possibly in a tab that has since been closed), so only
 *     confirm() is left, and confirm needs no wallet: the backend reads the
 *     chain itself;
 *   - the wallet's connection, chain and STATE_AUTHORITY_ROLE, which gate
 *     signing only.
 */

import type { DraftKind, OpenDraft } from '../api/types';

export type DraftStep =
  | 'loading'
  | 'create'
  | 'blockedByOtherDraft'
  | 'confirm'
  | 'connect'
  | 'wrongChain'
  | 'noRole'
  | 'sign';

export interface DraftStepInput {
  /** Which kind of draft this screen publishes. */
  currentKind: DraftKind;
  /** `undefined` while loading; `null` when no draft is open. */
  openDraft: OpenDraft | null | undefined;
  /** Decimal latestRoot read from the chain; `undefined` while loading. */
  onChainLatestRoot: string | undefined;
  walletConnected: boolean;
  walletChainId: number | undefined;
  /** The deployment's chain, from GET /government/status (D54). */
  expectedChainId: number | undefined;
  /** `undefined` until the role check has answered. */
  hasRole: boolean | undefined;
}

export function nextDraftStep(input: DraftStepInput): DraftStep {
  const { openDraft } = input;
  if (openDraft === undefined) return 'loading';
  if (openDraft === null) return 'create';
  if (openDraft.kind !== input.currentKind) return 'blockedByOtherDraft';

  if (input.onChainLatestRoot === undefined) return 'loading';
  if (input.onChainLatestRoot === openDraft.newRoot) return 'confirm';

  if (!input.walletConnected) return 'connect';
  if (input.walletChainId !== input.expectedChainId) return 'wrongChain';
  if (input.hasRole === undefined) return 'loading';
  if (!input.hasRole) return 'noRole';
  return 'sign';
}
