import { communeNameOf, normaliseUnitName } from './administrative-units.service';

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
