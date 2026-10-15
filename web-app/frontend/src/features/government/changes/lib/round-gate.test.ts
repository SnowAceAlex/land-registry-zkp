import { describe, expect, it } from 'vitest';

import type { Alert } from '../../api/types';
import { ackSignature, roundGate } from './round-gate';

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

  it('blocks on any error, and lists only the errors', () => {
    const error = alert('error', 'ChainAheadOfDatabase');
    const gate = roundGate([alert('warning'), error, alert('info')]);
    expect(gate).toEqual({ state: 'blocked', reasons: [error] });
  });
});

describe('ackSignature (D84)', () => {
  const a: Alert = { code: 'RevocationBacklog', severity: 'warning', count: 3, ref: 2 };
  const b: Alert = { code: 'StaleQueueItem', severity: 'warning', count: 1, officeCode: 'CN02' };

  it('is the same for the same warnings in any order', () => {
    expect(ackSignature([a, b])).toBe(ackSignature([b, a]));
  });

  it('ignores a count that moved but not which warnings are showing', () => {
    expect(ackSignature([a])).toBe(ackSignature([{ ...a, count: 9 }]));
  });

  it('changes when a warning is added, removed or moves to another office', () => {
    expect(ackSignature([a, b])).not.toBe(ackSignature([a]));
    expect(ackSignature([b])).not.toBe(ackSignature([{ ...b, officeCode: 'CN03' }]));
  });
});
