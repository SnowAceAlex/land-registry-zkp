import type { ArchiveSummary } from '../../api/types';

export type ArchiveStatus = 'expired' | 'expiring' | 'downloaded' | 'waiting';

const WARN_MS = 2 * 24 * 3600 * 1000;

/** Expired wins over everything; an undownloaded archive within 2 days of expiry is "expiring". */
export function archiveStatus(a: ArchiveSummary, now: Date): ArchiveStatus {
  const left = new Date(a.expiresAt).getTime() - now.getTime();
  if (a.expired || left <= 0) return 'expired';
  if (a.firstDownloadedAt !== null) return 'downloaded';
  return left <= WARN_MS ? 'expiring' : 'waiting';
}

/** Whole days and hours left, for the "expires in" cell. Null once it has expired. */
export function timeLeft(a: ArchiveSummary, now: Date): { days: number; hours: number } | null {
  const left = new Date(a.expiresAt).getTime() - now.getTime();
  if (left <= 0) return null;
  const hours = Math.floor(left / 3600_000);
  return { days: Math.floor(hours / 24), hours: hours % 24 };
}
