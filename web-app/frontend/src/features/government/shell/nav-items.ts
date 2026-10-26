import type { ActorScope } from '../api/types';

/** Route slugs of the government portal; not translated. */
export type GovNavSlug =
  | 'operations'
  | 'import'
  | 'issuance'
  | 'transfers'
  | 'revocations'
  | 'changes'
  | 'archives';

const BRANCH: GovNavSlug[] = ['operations', 'transfers', 'revocations', 'archives'];
const CENTRAL: GovNavSlug[] = [
  'operations',
  'import',
  'issuance',
  'transfers',
  'revocations',
  'changes',
  'archives',
];

/** Pages an office sees by scope (D86). Unknown scope (still loading) shows none. */
export function navItemsFor(scope: ActorScope | undefined): GovNavSlug[] {
  if (scope === 'CENTRAL') return CENTRAL;
  if (scope === 'BRANCH') return BRANCH;
  return [];
}
