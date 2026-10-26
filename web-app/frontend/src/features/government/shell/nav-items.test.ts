import { describe, expect, it } from 'vitest';

import { navItemsFor } from './nav-items';

describe('navItemsFor', () => {
  it('shows nothing until the scope is known', () => {
    expect(navItemsFor(undefined)).toEqual([]);
  });

  it('gives a branch only the counter work and the archive', () => {
    expect(navItemsFor('BRANCH')).toEqual(['operations', 'transfers', 'revocations', 'archives']);
  });

  it('gives the central office every page', () => {
    expect(navItemsFor('CENTRAL')).toEqual([
      'operations',
      'import',
      'issuance',
      'transfers',
      'revocations',
      'changes',
      'archives',
    ]);
  });
});
