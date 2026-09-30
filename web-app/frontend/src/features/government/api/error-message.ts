/**
 * features/government/api/error-message.ts - a failure, in the officer's language.
 *
 * Every word here is translated and chosen by CODE. Nothing the backend, viem
 * or a wallet extension wrote reaches the screen: those are English, free-form,
 * and were producing a Vietnamese headline over an English paragraph. They go
 * to the console through `logFailure` instead, which is where the person who
 * can act on them is looking.
 *
 * `detail` survives as a field, but it now carries a SECOND DICTIONARY STRING —
 * never a captured message.
 */

import type { Dictionary } from '@/i18n/dictionaries';

import { type WalletErrorCode, walletErrorCode } from '../wallet/registry';
import { type ApiErrorCode, apiErrorCode, logFailure } from './error-code';

type ErrorStrings = Dictionary['govErrors'];

export interface Failure {
  title: string;
  /** Translated text only — see the header. */
  detail?: string;
}

const API_TITLES: Record<ApiErrorCode, keyof ErrorStrings> = {
  'bad-request': 'badRequest',
  unauthorized: 'unauthorized',
  'not-found': 'notFound',
  conflict: 'conflict',
  gone: 'gone',
  unprocessable: 'unprocessable',
  'service-unavailable': 'serviceUnavailable',
  'root-mismatch': 'rootMismatch',
  'stale-timestamp': 'staleTimestamp',
  'invalid-proof': 'invalidProof',
  'owner-frozen': 'ownerFrozen',
  'owner-not-frozen': 'ownerNotFrozen',
  unreachable: 'unreachable',
  unknown: 'unknown',
};

const WALLET_TITLES: Record<WalletErrorCode, keyof ErrorStrings> = {
  rejected: 'walletRejected',
  'duplicate-root': 'walletDuplicateRoot',
  'no-role': 'walletNoRole',
  'already-revoked': 'walletAlreadyRevoked',
  'invalid-revocation': 'walletInvalidRevocation',
  'not-frozen': 'walletNotFrozen',
  'invalid-freeze': 'walletInvalidFreeze',
  unknown: 'walletUnknown',
};

export function apiFailure(error: unknown, t: ErrorStrings): Failure {
  logFailure('government/api', error);
  return { title: t[API_TITLES[apiErrorCode(error)]] };
}

export function walletFailure(error: unknown, t: ErrorStrings): Failure {
  const code = walletErrorCode(error);
  // Not logged when the officer simply pressed Cancel: that is a decision, not
  // a fault, and a console full of them hides the ones that matter.
  if (code !== 'rejected') logFailure('government/wallet', error);
  // viem's `shortMessage` used to be shown here. It is English prose like every
  // other captured message, and the six WALLET_TITLES already name each case an
  // officer can act on.
  return { title: t[WALLET_TITLES[code]] };
}
