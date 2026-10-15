import { describe, expect, it } from 'vitest';

import type { Alert } from '../../api/types';
import { roundGate } from './round-gate';

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
