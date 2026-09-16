import { describe, expect, it } from 'vitest';

import type { ChangeSetDraftDetail, IssuanceDraftDetail } from '../api/types';
import {
  bytes32ToDecimal,
  publishCallFor,
  rootRegistryAbi,
  rootToBytes32,
  walletErrorCode,
} from './registry';

/** A real BN254-sized root, well past Number.MAX_SAFE_INTEGER. */
const ROOT = '5677530015593700534173836181788122415198283309363871298832210090950018556857';

const issuanceDraft: IssuanceDraftDetail = {
  kind: 'issuance',
  id: 7,
  newRoot: ROOT,
  createdAt: '2026-09-14T02:00:00.000Z',
  propertyIds: ['1001'],
};

const changeSetDraft = (revocations: number): ChangeSetDraftDetail => ({
  kind: 'changeset',
  id: 9,
  newRoot: ROOT,
  createdAt: '2026-09-14T03:00:00.000Z',
  transferIds: [1],
  revocationIds: Array.from({ length: revocations }, (_, i) => i + 1),
  revocationCalldata: {
    propertyIds: Array.from({ length: revocations }, (_, i) => String(2000 + i)),
    reasonCodes: Array.from({ length: revocations }, () => 3),
    detailHashes: Array.from(
      { length: revocations },
      (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}` as const,
    ),
  },
  deferredRevocations: 0,
});

describe('root codec', () => {
  it('encodes a decimal root as the 32-byte word the contract stores', () => {
    const encoded = rootToBytes32('555');
    expect(encoded).toBe(`0x${'22b'.padStart(64, '0')}`);
  });

  it('round-trips a full-size field element without losing precision', () => {
    expect(bytes32ToDecimal(rootToBytes32(ROOT))).toBe(ROOT);
  });

  it('reads the zero root of a registry nothing was published to', () => {
    expect(bytes32ToDecimal(`0x${'0'.repeat(64)}`)).toBe('0');
  });
});

describe('publishCallFor (D54)', () => {
  it('publishes an issuance round with publishRoot', () => {
    expect(publishCallFor(issuanceDraft)).toEqual({
      functionName: 'publishRoot',
      args: [rootToBytes32(ROOT)],
    });
  });

  it('keeps a change set without revocations on plain publishRoot', () => {
    expect(publishCallFor(changeSetDraft(0)).functionName).toBe('publishRoot');
  });

  it('carries the revocation calldata when the round revokes anything (D45)', () => {
    const draft = changeSetDraft(2);

    expect(publishCallFor(draft)).toEqual({
      functionName: 'publishRootWithRevocations',
      args: [
        rootToBytes32(ROOT),
        [2000n, 2001n],
        [3, 3],
        draft.revocationCalldata.detailHashes,
      ],
    });
  });
});

describe('rootRegistryAbi', () => {
  it('comes from the compiled artifact and exposes every function the portal calls', () => {
    const names = rootRegistryAbi
      .filter((item) => item.type === 'function')
      .map((item) => item.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'publishRoot',
        'publishRootWithRevocations',
        'latestRoot',
        'hasRole',
        'STATE_AUTHORITY_ROLE',
      ]),
    );
  });
});

describe('walletErrorCode', () => {
  // Shaped like viem's errors: a BaseError chain linked through `cause`, the
  // revert decoded onto a ContractFunctionRevertedError's `data.errorName`.
  const revert = (errorName: string) => ({
    name: 'ContractFunctionExecutionError',
    cause: { name: 'ContractFunctionRevertedError', data: { errorName } },
  });

  it('recognises a signature the officer cancelled', () => {
    expect(
      walletErrorCode({ name: 'TransactionExecutionError', cause: { name: 'UserRejectedRequestError' } }),
    ).toBe('rejected');
    expect(walletErrorCode({ code: 4001, message: 'User denied' })).toBe('rejected');
  });

  it('maps the RootRegistry reverts the portal can explain', () => {
    expect(walletErrorCode(revert('DuplicateRoot'))).toBe('duplicate-root');
    expect(walletErrorCode(revert('AccessControlUnauthorizedAccount'))).toBe('no-role');
    expect(walletErrorCode(revert('AlreadyRevoked'))).toBe('already-revoked');
    expect(walletErrorCode(revert('InvalidReasonCode'))).toBe('invalid-revocation');
    expect(walletErrorCode(revert('RevocationArrayLengthMismatch'))).toBe('invalid-revocation');
  });

  it('falls back to unknown for anything else', () => {
    expect(walletErrorCode(new Error('boom'))).toBe('unknown');
    expect(walletErrorCode(revert('SomethingElse'))).toBe('unknown');
    expect(walletErrorCode(undefined)).toBe('unknown');
  });
});
