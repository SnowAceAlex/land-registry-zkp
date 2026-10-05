/**
 * features/government/wallet/registry.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What the portal needs to talk to RootRegistry that is not a React hook:
 * which function a draft publishes with, and what a wallet failure means.
 *
 * The ABI and the root codec moved to `lib/contracts.ts` when the resident
 * portal needed the same two things (D66) — the portals cannot import each
 * other, so shared code is promoted rather than copied. They are re-exported
 * here so no government screen changed. What stays is government-only: which
 * function a draft publishes with, and what a wallet failure means.
 *
 * The address is not here at all: it comes from GET /government/status (D54).
 */

import type { Hex } from 'viem';

import { rootToBytes32 } from '@/lib/contracts';
import type { OpenDraft } from '../api/types';

export { bytes32ToDecimal, rootRegistryAbi, rootToBytes32 } from '@/lib/contracts';

export type PublishCall =
  | { functionName: 'publishRoot'; args: readonly [Hex] }
  | {
      functionName: 'publishRootWithRevocations';
      args: readonly [Hex, readonly bigint[], readonly number[], readonly Hex[]];
    };

/**
 * The transaction a draft is published with — same rule as transferSmoke.ts:
 * an issuance round is always `publishRoot`; a change set uses
 * `publishRootWithRevocations` only when it revokes something, since that is
 * the function that also writes the public `revocations` mapping (D45).
 *
 * Signing `publishRoot` for a round that has revocations would still let
 * confirm() succeed (the root matches) while leaving the on-chain audit trail
 * empty — which is why this choice is made here, once, and not per screen.
 */
export function publishCallFor(draft: OpenDraft): PublishCall {
  const newRoot = rootToBytes32(draft.newRoot);
  if (draft.kind === 'changeset' && draft.revocationIds.length > 0) {
    const { propertyIds, reasonCodes, detailHashes } = draft.revocationCalldata;
    return {
      functionName: 'publishRootWithRevocations',
      args: [newRoot, propertyIds.map((id) => BigInt(id)), reasonCodes, detailHashes],
    };
  }
  return { functionName: 'publishRoot', args: [newRoot] };
}

export type WalletErrorCode =
  'rejected' | 'duplicate-root' | 'no-role' | 'already-revoked' | 'invalid-revocation' | 'unknown';

const REVERT_CODES: Record<string, WalletErrorCode> = {
  DuplicateRoot: 'duplicate-root',
  AccessControlUnauthorizedAccount: 'no-role',
  AlreadyRevoked: 'already-revoked',
  InvalidReasonCode: 'invalid-revocation',
  RevocationArrayLengthMismatch: 'invalid-revocation',
};

/**
 * What a failed wallet call means, for the screen to explain. Walks the
 * `cause` chain the way viem's BaseError.walk() does, looking for a cancelled
 * signature (EIP-1193 code 4001) or a decoded RootRegistry custom error.
 */
export function walletErrorCode(error: unknown): WalletErrorCode {
  for (
    let node = error as Record<string, unknown> | undefined, depth = 0;
    node && depth < 10;
    depth++
  ) {
    if (node.name === 'UserRejectedRequestError' || node.code === 4001) return 'rejected';
    const data = node.data as { errorName?: unknown } | undefined;
    const errorName = typeof data?.errorName === 'string' ? data.errorName : undefined;
    if (errorName) return REVERT_CODES[errorName] ?? 'unknown';
    node = node.cause as Record<string, unknown> | undefined;
  }
  return 'unknown';
}
