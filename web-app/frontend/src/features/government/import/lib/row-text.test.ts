import { describe, expect, it } from 'vitest';

import en from '@/i18n/dictionaries/en.json';
import vi from '@/i18n/dictionaries/vi.json';

import { type ImportRowCode, rowText } from './row-text';

// Record forces a new ImportRowCode to be listed here, and so to be worded below.
const CODES: Record<ImportRowCode, true> = {
  InvalidSupersedes: true,
  PredecessorNotFound: true,
  SelfSupersession: true,
  PredecessorNeverIssued: true,
  PredecessorAlreadySucceeded: true,
};

describe.each([
  ['en', en.govImport],
  ['vi', vi.govImport],
])('rowText (%s)', (_name, t) => {
  it.each(Object.keys(CODES) as ImportRowCode[])('words %s from the dictionary', (code) => {
    const text = rowText({ code, message: 'backend text' }, t);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe('backend text');
    expect(text).not.toMatch(/[{}]/);
  });

  it('falls back to the message for a row without a code', () => {
    expect(rowText({ message: "Unknown landUseCode 'ZZZ'" }, t)).toBe("Unknown landUseCode 'ZZZ'");
  });

  it('falls back to the message for a code this build does not know', () => {
    const row = { code: 'SomethingNew' as ImportRowCode, message: 'raw' };
    expect(rowText(row, t)).toBe('raw');
  });
});
