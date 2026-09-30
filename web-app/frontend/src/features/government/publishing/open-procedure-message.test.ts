import { describe, expect, it } from 'vitest';

import type { Dictionary } from '@/i18n/dictionaries';

import { openProcedureMessage } from './open-procedure-message';

const t = {
  openProcedureTransfer: 'transfer #{id}',
  openProcedureRevocation: 'revocation #{id}',
} as Dictionary['govFreeze'];

describe('openProcedureMessage', () => {
  it('picks the transfer message', () => {
    expect(openProcedureMessage(t, { kind: 'transfer', id: 7, status: 'PENDING' })).toBe(
      'transfer #7',
    );
  });

  it('picks the revocation message', () => {
    expect(openProcedureMessage(t, { kind: 'revocation', id: 3 })).toBe('revocation #3');
  });
});
