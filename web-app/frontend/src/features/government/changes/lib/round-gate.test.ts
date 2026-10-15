import { describe, expect, it } from 'vitest';

import type { Alert } from '../../api/types';
import { ackSignature, ROUND_BLOCKING_CODES, roundGate } from './round-gate';

const alert = (severity: Alert['severity'], code: Alert['code'] = 'HeldItems'): Alert => ({
  code,
  severity,
});

describe('roundGate (D84)', () => {
  it('is clear with no alerts', () => {
    expect(roundGate([])).toEqual({ state: 'clear' });
  });

  it('ignores info alerts', () => {
    expect(roundGate([alert('info'), alert('info', 'UnassignedProperties')])).toEqual({
      state: 'clear',
    });
  });

  it('asks for an acknowledgement when only warnings remain, listing them', () => {
    const warning = alert('warning', 'RevocationBacklog');
    expect(roundGate([alert('info'), warning])).toEqual({ state: 'needs-ack', reasons: [warning] });
  });

  it('blocks only on ChainAheadOfDatabase, and lists only the blocking alerts', () => {
    expect(ROUND_BLOCKING_CODES).toEqual(['ChainAheadOfDatabase']);
    const error = alert('error', 'ChainAheadOfDatabase');
    const gate = roundGate([alert('warning'), error, alert('error', 'ArchiveExpiredUndownloaded')]);
    expect(gate).toEqual({ state: 'blocked', reasons: [error] });
  });

  it('asks for an acknowledgement on an expired archive, which never clears by itself', () => {
    const expired = alert('error', 'ArchiveExpiredUndownloaded');
    expect(roundGate([expired])).toEqual({ state: 'needs-ack', reasons: [expired] });
  });

  it('asks for an acknowledgement on a missing role, error or not', () => {
    const role = alert('error', 'AuthorityRoleMissing');
    const warning = alert('warning', 'StaleQueueItem');
    expect(roundGate([role, alert('info'), warning])).toEqual({
      state: 'needs-ack',
      reasons: [role, warning],
    });
  });
});

describe('ackSignature (D84)', () => {
  const a: Alert = { code: 'RevocationBacklog', severity: 'warning', count: 3, ref: 2 };
  const b: Alert = { code: 'StaleQueueItem', severity: 'warning', count: 1, officeCode: 'CN02' };

  it('is the same for the same warnings in any order', () => {
    expect(ackSignature([a, b])).toBe(ackSignature([b, a]));
  });

  it('changes when a count moves, so a tick for one item does not cover five', () => {
    expect(ackSignature([b])).not.toBe(ackSignature([{ ...b, count: 5 }]));
  });

  it('changes when a warning is added, removed or moves to another office', () => {
    expect(ackSignature([a, b])).not.toBe(ackSignature([a]));
    expect(ackSignature([b])).not.toBe(ackSignature([{ ...b, officeCode: 'CN03' }]));
  });
});
