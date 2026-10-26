import { describe, expect, it } from 'vitest';

import type { Me } from '../../api/types';
import { canWithdrawTransfer } from './can-withdraw';

const central: Me = { scope: 'CENTRAL', office: { code: 'HQ', name: 'HQ', kind: 'HEAD_OFFICE' } };
const branch: Me = { scope: 'BRANCH', office: { code: 'CN02', name: 'CN02', kind: 'BRANCH' } };

describe('canWithdrawTransfer', () => {
  it('lets the central office withdraw an approved transfer', () => {
    expect(canWithdrawTransfer(central, { status: 'APPROVED', landOfficeCode: 'CN02' })).toBe(true);
  });

  it('never offers withdrawal for a pending transfer (that is a rejection)', () => {
    expect(canWithdrawTransfer(central, { status: 'PENDING', landOfficeCode: 'CN02' })).toBe(false);
  });

  it('refuses a branch even on its own plot', () => {
    expect(canWithdrawTransfer(branch, { status: 'APPROVED', landOfficeCode: 'CN02' })).toBe(false);
  });

  it('refuses finished transfers and an unknown actor', () => {
    expect(canWithdrawTransfer(central, { status: 'PUBLISHED', landOfficeCode: null })).toBe(false);
    expect(canWithdrawTransfer(central, { status: 'REJECTED', landOfficeCode: null })).toBe(false);
    expect(canWithdrawTransfer(undefined, { status: 'APPROVED', landOfficeCode: null })).toBe(
      false,
    );
  });
});
