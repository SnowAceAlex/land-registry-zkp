import { describe, expect, it } from 'vitest';

import type { ArchiveSummary } from '../../api/types';
import { archiveStatus } from './archive-status';

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
