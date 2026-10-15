import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Actor } from './actor';
import { CentralOnlyGuard } from './central-only.guard';

const ctxWith = (actor?: Actor) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ actor }) }) }) as unknown as ExecutionContext;

const actor = (scope: Actor['scope']): Actor => ({
  officeId: 1,
  officeCode: 'X',
  officeName: 'X',
  officeKind: scope === 'CENTRAL' ? 'HEAD_OFFICE' : 'BRANCH',
  scope,
  credentialId: null,
});

describe('CentralOnlyGuard', () => {
  const guard = new CentralOnlyGuard();

  it('lets a central actor through', () => {
    expect(guard.canActivate(ctxWith(actor('CENTRAL')))).toBe(true);
  });

  it('rejects a branch actor with CentralScopeRequired', () => {
    try {
      guard.canActivate(ctxWith(actor('BRANCH')));
      fail('expected ForbiddenException');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({
        reason: 'CentralScopeRequired',
      });
    }
  });

  it('rejects when no actor was resolved (guard ordering mistake)', () => {
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });
});
