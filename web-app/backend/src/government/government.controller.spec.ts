import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { CentralOnlyGuard } from '../common/central-only.guard';
import { BRANCH_ACTOR } from '../../test/factories';
import { GovernmentController } from './government.controller';

const guardsOf = (method: keyof GovernmentController): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, GovernmentController.prototype[method]) ?? [];

const branchRequest = {
  switchToHttp: () => ({ getRequest: () => ({ actor: BRANCH_ACTOR }) }),
} as unknown as ExecutionContext;

describe('GovernmentController — who may run a publishing round (D86)', () => {
  it.each(['createChangeSetDraft', 'confirmChangeSetDraft', 'discardChangeSetDraft'] as const)(
    '%s answers a branch with 403 CentralScopeRequired',
    (method) => {
      expect(guardsOf(method)).toContain(CentralOnlyGuard);
      expect(() => new CentralOnlyGuard().canActivate(branchRequest)).toThrow(ForbiddenException);
    },
  );

  it.each(['pendingChanges', 'listChangeSets'] as const)('%s stays open to a branch', (method) => {
    expect(guardsOf(method)).not.toContain(CentralOnlyGuard);
  });
});

describe('GovernmentController — who may import and queue issuance (D86, D87)', () => {
  it.each(['import', 'requestIssuance', 'listIssuanceRequests'] as const)(
    '%s answers a branch with 403 CentralScopeRequired',
    (method) => {
      expect(guardsOf(method)).toContain(CentralOnlyGuard);
    },
  );
});
