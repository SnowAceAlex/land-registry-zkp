import { describe, expect, it } from 'vitest';

import type { ChangeSetDraftDetail } from '../api/types';
import { type DraftStepInput, nextDraftStep } from './next-draft-step';

const draft: ChangeSetDraftDetail = {
  kind: 'changeset',
  id: 9,
  newRoot: '555',
  createdAt: '2026-09-14T03:00:00.000Z',
  issuanceRequestIds: [3],
  transferIds: [1],
  revocationIds: [],
  revocationCalldata: { propertyIds: [], reasonCodes: [], detailHashes: [] },
  deferredRevocations: 0,
};

/** A wallet ready to sign a round that is not yet on chain. */
const ready: DraftStepInput = {
  openDraft: draft,
  onChainLatestRoot: '111',
  walletConnected: true,
  walletChainId: 31337,
  expectedChainId: 31337,
  hasRole: true,
};

describe('nextDraftStep (D53)', () => {
  it('waits while the open draft is still loading', () => {
    expect(nextDraftStep({ ...ready, openDraft: undefined })).toBe('loading');
  });

  it('offers to create a draft when none is open', () => {
    expect(nextDraftStep({ ...ready, openDraft: null })).toBe('create');
  });

  it('waits for the chain before deciding between sign and confirm', () => {
    expect(nextDraftStep({ ...ready, onChainLatestRoot: undefined })).toBe('loading');
  });

  it('offers confirm once the draft root is the chain root, whatever the wallet is doing', () => {
    // The resume path: signed, tab closed, reopened. The wallet may be locked
    // or on another chain — confirm needs no wallet, the backend reads the chain.
    expect(
      nextDraftStep({
        ...ready,
        onChainLatestRoot: '555',
        walletConnected: false,
        walletChainId: undefined,
        hasRole: undefined,
      }),
    ).toBe('confirm');
  });

  it('asks for a wallet before signing', () => {
    expect(nextDraftStep({ ...ready, walletConnected: false })).toBe('connect');
  });

  it('refuses to sign on a chain the backend does not read (D54)', () => {
    expect(nextDraftStep({ ...ready, walletChainId: 11155111 })).toBe('wrongChain');
  });

  it('refuses to sign without the state-authority role', () => {
    expect(nextDraftStep({ ...ready, hasRole: false })).toBe('noRole');
    expect(nextDraftStep({ ...ready, hasRole: undefined })).toBe('loading');
  });

  it('signs when everything lines up', () => {
    expect(nextDraftStep(ready)).toBe('sign');
  });
});
