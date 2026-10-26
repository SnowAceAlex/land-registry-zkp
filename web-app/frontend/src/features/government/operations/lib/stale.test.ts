import { describe, expect, it } from 'vitest';

import type { Alert } from '../../api/types';
import { isOfficeStale } from './stale';

const stale = (officeCode?: string): Alert => ({
  code: 'StaleQueueItem',
  severity: 'warning',
  count: 1,
  ...(officeCode && { officeCode }),
});

describe('isOfficeStale', () => {
  it('matches the office named by a StaleQueueItem alert', () => {
    expect(isOfficeStale([stale('CN02')], 'CN02')).toBe(true);
    expect(isOfficeStale([stale('CN02')], 'CN03')).toBe(false);
  });

  it('matches the unassigned row only for an alert without an office', () => {
    expect(isOfficeStale([stale()], null)).toBe(true);
    expect(isOfficeStale([stale('CN02')], null)).toBe(false);
    expect(isOfficeStale([stale()], 'CN02')).toBe(false);
  });

  it('ignores other alert codes', () => {
    const other: Alert = { code: 'HeldItems', severity: 'info', count: 4, officeCode: 'CN02' };
    expect(isOfficeStale([other], 'CN02')).toBe(false);
  });
});
