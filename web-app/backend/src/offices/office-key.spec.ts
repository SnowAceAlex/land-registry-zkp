import { createHash } from 'crypto';

import { generateOfficeKey, hashOfficeKey } from './office-key';

describe('office key', () => {
  it('is 32 random bytes as 64 hex chars', () => {
    expect(generateOfficeKey()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs between calls', () => {
    expect(generateOfficeKey()).not.toBe(generateOfficeKey());
  });

  it('hashes to a stable sha256 hex', () => {
    const key = 'ab'.repeat(32);
    expect(hashOfficeKey(key)).toBe(createHash('sha256').update(key).digest('hex'));
    expect(hashOfficeKey(key)).toBe(hashOfficeKey(key));
  });
});
