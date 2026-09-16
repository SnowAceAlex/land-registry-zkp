/**
 * features/government/api/error-message.ts - a failure, in the officer's language.
 *
 * Title: translated, chosen by code. Detail: the backend's or wallet's own text,
 * untranslated, because it names the exact draft, plot or root involved.
 */

import type { Dictionary } from '@/i18n/dictionaries';

import { type WalletErrorCode, walletErrorCode } from '../wallet/registry';
import { type ApiErrorCode, apiErrorCode, errorDetail } from './error-code';

type ErrorStrings = Dictionary['govErrors'];

export interface Failure {
  title: string;
  detail?: string;
}

const API_TITLES: Record<ApiErrorCode, keyof ErrorStrings> = {
  'bad-request': 'badRequest',
  unauthorized: 'unauthorized',
  'not-found': 'notFound',
  conflict: 'conflict',
  gone: 'gone',
  unprocessable: 'unprocessable',
  'root-mismatch': 'rootMismatch',
  'stale-timestamp': 'staleTimestamp',
  'invalid-proof': 'invalidProof',
  unreachable: 'unreachable',
  unknown: 'unknown',
};

const WALLET_TITLES: Record<WalletErrorCode, keyof ErrorStrings> = {
  rejected: 'walletRejected',
  'duplicate-root': 'walletDuplicateRoot',
  'no-role': 'walletNoRole',
  'already-revoked': 'walletAlreadyRevoked',
  'invalid-revocation': 'walletInvalidRevocation',
  unknown: 'walletUnknown',
};

export function apiFailure(error: unknown, t: ErrorStrings): Failure {
  return { title: t[API_TITLES[apiErrorCode(error)]], detail: errorDetail(error) };
}

export function walletFailure(error: unknown, t: ErrorStrings): Failure {
  const code = walletErrorCode(error);
  // A cancelled signature needs no stack of wallet internals under it.
  const detail =
    code === 'rejected'
      ? undefined
      : ((error as { shortMessage?: string })?.shortMessage ?? errorDetail(error));
  return { title: t[WALLET_TITLES[code]], detail };
}
