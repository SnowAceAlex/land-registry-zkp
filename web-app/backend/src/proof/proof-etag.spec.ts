import { proofETag } from './proof-etag';

describe('proofETag (D74)', () => {
  it('is a quoted strong validator (RFC 9110)', () => {
    expect(proofETag(7, '123')).toBe('"v7-p123"');
  });

  it('changes when the root version changes — the only thing that invalidates a proof', () => {
    expect(proofETag(7, '123')).not.toBe(proofETag(8, '123'));
  });

  it('differs per property at the same root version', () => {
    expect(proofETag(7, '123')).not.toBe(proofETag(7, '124'));
  });

  it('cannot be confused between plot and version by concatenation', () => {
    // Without the `v`/`p` markers, (1, '23') and (12, '3') would both read
    // "1-23"-ish and a client could be handed a 304 for a different plot.
    expect(proofETag(1, '23')).not.toBe(proofETag(12, '3'));
  });
});
