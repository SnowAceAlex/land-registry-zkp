import { describe, expect, it } from 'vitest';

import en from '@/i18n/dictionaries/en.json';
import vi from '@/i18n/dictionaries/vi.json';

import type { Alert, AlertCode } from './types';
import { alertGroupText, alertText, groupAlerts } from './alert-text';

// Record forces a new AlertCode to be listed here, and so to be worded below.
const CODES: Record<AlertCode, true> = {
  ChainAheadOfDatabase: true,
  PendingTransfersWouldBreak: true,
  RevocationBacklog: true,
  StaleQueueItem: true,
  ArchiveNotDownloaded: true,
  ArchiveExpiredUndownloaded: true,
  UnassignedProperties: true,
  HeldItems: true,
  AuthorityRoleMissing: true,
  AttesterRoleMissing: true,
};

const sample = (code: AlertCode, severity: Alert['severity'] = 'warning'): Alert => ({
  code,
  severity,
  count: 7,
  officeCode: 'CN07',
  ref: 398,
});

describe.each([
  ['en', en.govOperations],
  ['vi', vi.govOperations],
])('alertText (%s)', (_name, t) => {
  it.each(Object.keys(CODES) as AlertCode[])('words %s with no placeholder left over', (code) => {
    const { title } = alertText(sample(code), t);
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toMatch(/[{}]/);
  });

  it('maps severity to tone', () => {
    expect(alertText(sample('HeldItems', 'error'), t).tone).toBe('danger');
    expect(alertText(sample('HeldItems', 'warning'), t).tone).toBe('warning');
    expect(alertText(sample('HeldItems', 'info'), t).tone).toBe('info');
  });

  it('fills the count and the round reference', () => {
    expect(alertText({ code: 'RevocationBacklog', severity: 'warning', count: 2140, ref: 15 }, t).title).toMatch(
      /15/,
    );
  });

  it('needs no office or ref where the backend sends none', () => {
    const withRef = ['ArchiveNotDownloaded', 'ArchiveExpiredUndownloaded', 'RevocationBacklog'];
    for (const code of Object.keys(CODES) as AlertCode[]) {
      if (withRef.includes(code)) continue;
      expect(alertText({ code, severity: 'info', count: 3 }, t).title).not.toMatch(/[{}]/);
    }
  });

  it('names the office inside the sentence, never after it', () => {
    for (const code of Object.keys(CODES) as AlertCode[]) {
      const { title } = alertText(sample(code), t);
      expect(title).not.toContain('. (');
    }
    const stale = alertText({ code: 'StaleQueueItem', severity: 'warning', count: 2, officeCode: 'CN02' }, t);
    expect(stale.title).toContain('CN02');
  });

  it('speaks of unassigned plots when the alert has no office', () => {
    const { title } = alertText({ code: 'StaleQueueItem', severity: 'warning', count: 2 }, t);
    expect(title).toContain(t.alertNoOffice);
  });

  it.each(['ArchiveNotDownloaded', 'ArchiveExpiredUndownloaded'] as const)(
    'words a merged %s by office count and lists the offices as detail',
    (code) => {
      const [group] = groupAlerts([
        { code, severity: 'error', officeCode: 'CN14', ref: 8 },
        { code, severity: 'error', officeCode: 'CN02', ref: 8 },
      ]);
      const { tone, title, detail } = alertGroupText(group, t);
      expect(tone).toBe('danger');
      expect(title).toContain('#8');
      expect(title).toContain('2');
      expect(title).not.toMatch(/[{}]/);
      expect(detail).toBe('CN02, CN14');
    },
  );

  it('words a one-office group exactly as alertText', () => {
    const alert: Alert = { code: 'ArchiveExpiredUndownloaded', severity: 'error', officeCode: 'CN02', ref: 8 };
    expect(alertGroupText({ alert, officeCodes: ['CN02'] }, t)).toEqual(alertText(alert, t));
  });
});

describe('groupAlerts (D92)', () => {
  const expired = (officeCode: string, ref = 8): Alert => ({
    code: 'ArchiveExpiredUndownloaded',
    severity: 'error',
    officeCode,
    ref,
  });

  it('merges one round’s archive alerts into one entry, offices sorted', () => {
    const groups = groupAlerts([expired('CN14'), expired('CN02'), expired('CN09')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].officeCodes).toEqual(['CN02', 'CN09', 'CN14']);
  });

  it('keeps rounds and codes apart, and every other alert as it is, in order', () => {
    const chain: Alert = { code: 'ChainAheadOfDatabase', severity: 'error' };
    const stale1: Alert = { code: 'StaleQueueItem', severity: 'warning', count: 2, officeCode: 'CN01' };
    const stale2: Alert = { ...stale1, officeCode: 'CN02' };
    const near: Alert = { code: 'ArchiveNotDownloaded', severity: 'warning', officeCode: 'CN01', ref: 8 };

    const groups = groupAlerts([chain, expired('CN01', 7), expired('CN01', 8), stale1, stale2, near]);

    expect(groups.map((g) => [g.alert.code, g.alert.ref, g.officeCodes])).toEqual([
      ['ChainAheadOfDatabase', undefined, []],
      ['ArchiveExpiredUndownloaded', 7, ['CN01']],
      ['ArchiveExpiredUndownloaded', 8, ['CN01']],
      ['StaleQueueItem', undefined, ['CN01']],
      ['StaleQueueItem', undefined, ['CN02']],
      ['ArchiveNotDownloaded', 8, ['CN01']],
    ]);
  });
});

describe('dictionary parity', () => {
  it('has the same alert keys in en and vi', () => {
    expect(Object.keys(vi.govOperations.alerts).sort()).toEqual(Object.keys(en.govOperations.alerts).sort());
    expect(Object.keys(en.govOperations.alerts).sort()).toEqual(Object.keys(CODES).sort());
  });
});
