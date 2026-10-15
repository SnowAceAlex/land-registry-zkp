import { ForbiddenException } from '@nestjs/common';
import { Actor } from './actor';
import { assertCanActOn, isFallback } from './office-scope';

const central: Actor = {
  officeId: 1,
  officeCode: 'HQ',
  officeName: 'HQ',
  officeKind: 'HEAD_OFFICE',
  scope: 'CENTRAL',
  credentialId: null,
};
const branch: Actor = {
  officeId: 9,
  officeCode: 'CN01',
  officeName: 'CN01',
  officeKind: 'BRANCH',
  scope: 'BRANCH',
  credentialId: 3,
};

describe('assertCanActOn', () => {
  it('lets a central actor act on any plot, even an unassigned one', () => {
    expect(() => assertCanActOn(central, { propertyId: '1', landOfficeId: 9 })).not.toThrow();
    expect(() => assertCanActOn(central, { propertyId: '1', landOfficeId: null })).not.toThrow();
  });

  it('lets a branch act on its own area', () => {
    expect(() => assertCanActOn(branch, { propertyId: '1', landOfficeId: 9 })).not.toThrow();
  });

  it('rejects a branch on another area with OutsideOfficeArea and the propertyId', () => {
    try {
      assertCanActOn(branch, { propertyId: '42', landOfficeId: 10 });
      fail('expected ForbiddenException');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({
        reason: 'OutsideOfficeArea',
        details: { propertyId: '42' },
      });
    }
  });

  it('rejects a branch on a plot with no office', () => {
    expect(() => assertCanActOn(branch, { propertyId: '1', landOfficeId: null })).toThrow(
      ForbiddenException,
    );
  });
});

describe('isFallback', () => {
  it.each([
    [1, 9, true],
    [9, 9, false],
    [1, null, false],
  ])('actor %s on plot office %s -> %s', (actorOffice, plotOffice, expected) => {
    expect(isFallback(actorOffice, plotOffice)).toBe(expected);
  });
});
