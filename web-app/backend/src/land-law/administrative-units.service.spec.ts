import {
  AdministrativeUnitsService,
  communeNameOf,
  normaliseUnitName,
} from './administrative-units.service';
import { PrismaService } from '../prisma/prisma.service';

describe('communeNameOf', () => {
  it('returns the commune without its prefix', () => {
    expect(communeNameOf('12 Phan Đăng Lưu, Phường Gia Định, TP.HCM')).toBe('Gia Định');
    expect(communeNameOf('Ấp 1, Xã Long Điền, TP.HCM')).toBe('Long Điền');
    expect(communeNameOf('Khu A, Đặc khu Côn Đảo, TP.HCM')).toBe('Côn Đảo');
  });

  it('returns null for zero or several commune segments', () => {
    expect(communeNameOf('12 Phan Đăng Lưu, TP.HCM')).toBeNull();
    expect(communeNameOf('Phường A, Xã B, TP.HCM')).toBeNull();
  });
});

describe('normaliseUnitName', () => {
  it('folds NFD, case and whitespace', () => {
    expect(normaliseUnitName('  Tân   Định ')).toBe(normaliseUnitName('tân định'));
  });
});

describe('AddressValidator.officeFor (D85)', () => {
  const CN01 = { id: 4, code: 'CN01' };
  const CN02 = { id: 5, code: 'CN02' };

  async function validatorOver(units: { name: string; landOffice: typeof CN01 | null }[]) {
    const prisma = { administrativeUnit: { findMany: jest.fn(async () => units) } };
    return new AdministrativeUnitsService(prisma as unknown as PrismaService).createValidator();
  }

  it('resolves the office of the address commune', async () => {
    const validator = await validatorOver([
      { name: 'Gia Định', landOffice: CN01 },
      { name: 'Long Điền', landOffice: null },
    ]);

    expect(validator.officeFor('12 Phan Đăng Lưu, Phường Gia Định, TP.HCM')).toEqual(CN01);
    expect(validator.officeFor('Ấp 1, Xã Long Điền, TP.HCM')).toBeNull();
    expect(validator.officeFor('Ấp 1, Xã Lạ, TP.HCM')).toBeNull();
    expect(validator.officeFor('12 Phan Đăng Lưu, TP.HCM')).toBeNull();
  });

  it('returns null for a name that two offices claim rather than guess', async () => {
    const validator = await validatorOver([
      { name: 'Tân Phú', landOffice: CN01 },
      { name: 'Tân Phú', landOffice: CN02 },
    ]);

    expect(validator.officeFor('Số 1, Phường Tân Phú, TP.HCM')).toBeNull();
  });

  it('returns null when the catalog is empty', async () => {
    const validator = await validatorOver([]);

    expect(validator.officeFor('Số 1, Phường Tân Phú, TP.HCM')).toBeNull();
  });
});
