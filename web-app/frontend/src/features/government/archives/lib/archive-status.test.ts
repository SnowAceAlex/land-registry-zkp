import { describe, expect, it } from 'vitest';

import type { ArchiveSummary } from '../../api/types';
import { archiveStatus, expiredHintKind, timeLeft } from './archive-status';

const NOW = new Date('2026-10-15T00:00:00Z');
const DAY = 24 * 3600 * 1000;

function archive(over: Partial<ArchiveSummary> = {}): ArchiveSummary {
  return {
    changeSetId: 1,
    rootVersion: 1,
    publishedAt: '2026-10-10T00:00:00Z',
    officeCode: 'HN',
    officeName: 'Hà Nội',
    propertyCount: 3,
    expiresAt: new Date(NOW.getTime() + 5 * DAY).toISOString(),
    expired: false,
    firstDownloadedAt: null,
    firstDownloadedByOfficeCode: null,
    ...over,
  };
}

describe('archiveStatus', () => {
  it('waiting: not downloaded, plenty of time left', () => {
    expect(archiveStatus(archive(), NOW)).toBe('waiting');
  });

  it('downloaded: fetched, still within its lifetime', () => {
    expect(archiveStatus(archive({ firstDownloadedAt: '2026-10-12T00:00:00Z' }), NOW)).toBe('downloaded');
  });

  it('expired: the server flag wins', () => {
    expect(archiveStatus(archive({ expired: true }), NOW)).toBe('expired');
  });

  it('expired: expiresAt already reached even if the flag lags', () => {
    expect(archiveStatus(archive({ expiresAt: NOW.toISOString() }), NOW)).toBe('expired');
    expect(archiveStatus(archive({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }), NOW)).toBe('expired');
  });

  it('expired even when it had been downloaded', () => {
    expect(
      archiveStatus(archive({ expired: true, firstDownloadedAt: '2026-10-12T00:00:00Z' }), NOW),
    ).toBe('expired');
  });

  it('expiring: not downloaded and exactly 2 days left', () => {
    expect(archiveStatus(archive({ expiresAt: new Date(NOW.getTime() + 2 * DAY).toISOString() }), NOW)).toBe(
      'expiring',
    );
  });

  it('waiting: not downloaded and 1 ms more than 2 days left', () => {
    expect(
      archiveStatus(archive({ expiresAt: new Date(NOW.getTime() + 2 * DAY + 1).toISOString() }), NOW),
    ).toBe('waiting');
  });

  it('a downloaded archive is never flagged expiring', () => {
    expect(
      archiveStatus(
        archive({
          firstDownloadedAt: '2026-10-12T00:00:00Z',
          expiresAt: new Date(NOW.getTime() + DAY).toISOString(),
        }),
        NOW,
      ),
    ).toBe('downloaded');
  });
});

describe('timeLeft', () => {
  const at = (ms: number) => archive({ expiresAt: new Date(NOW.getTime() + ms).toISOString() });
  const HOUR = 3600 * 1000;

  it('is null when expiresAt is now or past', () => {
    expect(timeLeft(at(0), NOW)).toBeNull();
    expect(timeLeft(at(-1), NOW)).toBeNull();
  });

  it('is 0 d 0 h under one hour', () => {
    expect(timeLeft(at(HOUR - 1), NOW)).toEqual({ days: 0, hours: 0 });
    expect(timeLeft(at(1), NOW)).toEqual({ days: 0, hours: 0 });
  });

  it('counts whole hours below a day', () => {
    expect(timeLeft(at(HOUR), NOW)).toEqual({ days: 0, hours: 1 });
    expect(timeLeft(at(23 * HOUR + 59 * 60_000), NOW)).toEqual({ days: 0, hours: 23 });
  });

  it('rolls hours over into days', () => {
    expect(timeLeft(at(24 * HOUR), NOW)).toEqual({ days: 1, hours: 0 });
    expect(timeLeft(at(47 * HOUR + 59 * 60_000), NOW)).toEqual({ days: 1, hours: 23 });
    expect(timeLeft(at(48 * HOUR), NOW)).toEqual({ days: 2, hours: 0 });
  });
});

describe('expiredHintKind', () => {
  it('asks for re-issue when the archive was never downloaded', () => {
    expect(expiredHintKind(archive({ expired: true }))).toBe('reissue');
  });

  it('is neutral once the secrets were delivered', () => {
    expect(
      expiredHintKind(archive({ expired: true, firstDownloadedAt: '2026-10-12T00:00:00Z' })),
    ).toBe('neutral');
  });
});
