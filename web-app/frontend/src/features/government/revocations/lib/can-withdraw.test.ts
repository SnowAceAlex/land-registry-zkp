import { describe, expect, it } from 'vitest';

import type { Me } from '../../api/types';
import { canWithdrawRevocation } from './can-withdraw';

const central: Me = { scope: 'CENTRAL', office: { code: 'HQ', name: 'HQ', kind: 'HEAD_OFFICE' } };
const branch: Me = { scope: 'BRANCH', office: { code: 'CN02', name: 'CN02', kind: 'BRANCH' } };

describe('canWithdrawRevocation', () => {
  it('lets the central office withdraw a pending revocation anywhere', () => {
    expect(canWithdrawRevocation(central, { status: 'PENDING', landOfficeCode: 'CN02' })).toBe(
      true,
    );
    expect(canWithdrawRevocation(central, { status: 'PENDING', landOfficeCode: null })).toBe(true);
  });

  it('lets a branch withdraw only revocations on its own area', () => {
    expect(canWithdrawRevocation(branch, { status: 'PENDING', landOfficeCode: 'CN02' })).toBe(true);
    expect(canWithdrawRevocation(branch, { status: 'PENDING', landOfficeCode: 'CN03' })).toBe(
      false,
    );
    expect(canWithdrawRevocation(branch, { status: 'PENDING', landOfficeCode: null })).toBe(false);
  });

  it('refuses anything that is no longer pending', () => {
    expect(canWithdrawRevocation(central, { status: 'PUBLISHED', landOfficeCode: 'CN02' })).toBe(
      false,
    );
    expect(canWithdrawRevocation(branch, { status: 'REJECTED', landOfficeCode: 'CN02' })).toBe(
      false,
    );
  });

  it('refuses while the actor is still unknown', () => {
    expect(canWithdrawRevocation(undefined, { status: 'PENDING', landOfficeCode: 'CN02' })).toBe(
      false,
    );
  });
});
