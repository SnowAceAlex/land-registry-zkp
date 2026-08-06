import { TenureType, UseType } from '@land-registry/blockchain/shared';
import {
  LAND_USE_CODES,
  LandUserType,
  allowedTenures,
  classifyLandUseCode,
  hasStatutoryFiftyYearTerm,
  landUseCodeLabel,
  resolveTenureType,
} from './land-use-code.map';

describe('land-use-code map (revised D2/D3)', () => {
  it('classifies residential codes as perpetual', () => {
    for (const code of ['ONT', 'ODT']) {
      expect(classifyLandUseCode(code)).toMatchObject({
        useType: UseType.RESIDENTIAL,
        defaultTenure: TenureType.PERPETUAL,
      });
    }
  });

  it('derives useType from the code but not the tenure', () => {
    // Both agricultural, so useType alone cannot determine the term — the
    // original reason D2 exists.
    expect(classifyLandUseCode('LUC').useType).toBe(UseType.AGRICULTURAL);
    expect(classifyLandUseCode('CLN').useType).toBe(UseType.AGRICULTURAL);
    expect(classifyLandUseCode('LUC').defaultTenure).toBe(TenureType.FIXED_TERM);
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(classifyLandUseCode('  ont ')).toEqual(classifyLandUseCode('ONT'));
  });

  it('rejects an unknown code instead of guessing a tenure', () => {
    expect(() => classifyLandUseCode('XYZ')).toThrow(/Unknown landUseCode/);
    expect(() => classifyLandUseCode('')).toThrow(/Unknown landUseCode/);
  });

  it('gives every code a Vietnamese label for the PDF', () => {
    for (const code of Object.keys(LAND_USE_CODES)) {
      expect(landUseCodeLabel(code).length).toBeGreaterThan(0);
    }
    expect(landUseCodeLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  describe('code table follows TT 08/2024 Phụ lục II', () => {
    it('rejects codes from the superseded tables', () => {
      // BHK/NHK were merged into HNK when Luật 2024 took effect; NTS_CD was
      // never a land category. All are simply absent from the current table.
      for (const code of ['BHK', 'NHK', 'NTS_CD', 'DDT', 'TTN', 'TRA']) {
        expect(() => classifyLandUseCode(code)).toThrow(/Unknown landUseCode/);
      }
    });

    it('serves HNK as a real code, not as "đất nông nghiệp khác"', () => {
      expect(classifyLandUseCode('HNK')).toMatchObject({
        useType: UseType.AGRICULTURAL,
        label: 'Đất trồng cây hằng năm khác',
      });
    });

    it('carries the codes Luật 2024 added or split out', () => {
      expect(classifyLandUseCode('LUK').label).toBe('Đất trồng lúa còn lại');
      expect(classifyLandUseCode('CNT').label).toBe('Đất chăn nuôi tập trung');
    });

    it('uses the current labels and spelling', () => {
      // TT 08/2024 dropped "nước" from the LUC label; "thủy" is the spelling in
      // the source text.
      expect(landUseCodeLabel('LUC')).toBe('Đất chuyên trồng lúa');
      expect(landUseCodeLabel('NTS')).toBe('Đất nuôi trồng thủy sản');
    });

    it('names the accepted codes when rejecting, so a stale export can be fixed', () => {
      expect(() => classifyLandUseCode('BHK')).toThrow(/HNK/);
      expect(() => classifyLandUseCode('BHK')).toThrow(/TT 08\/2024/);
    });
  });

  describe('tenure depends on how the land was granted, not only on the code', () => {
    it('falls back to the ordinary tenure when the import omits it', () => {
      expect(resolveTenureType('ONT', undefined)).toBe(TenureType.PERPETUAL);
      expect(resolveTenureType('LUC', undefined)).toBe(TenureType.FIXED_TERM);
      expect(resolveTenureType('TMD', undefined)).toBe(TenureType.PROJECT_LEASEHOLD);
    });

    it('allows commercial land recognised for an individual to be perpetual (Điều 171 khoản 4)', () => {
      // The case the old hard-coded map made unrepresentable.
      expect(resolveTenureType('TMD', TenureType.PERPETUAL)).toBe(TenureType.PERPETUAL);
      expect(resolveTenureType('SKC', TenureType.PERPETUAL)).toBe(TenureType.PERPETUAL);
    });

    it('allows production forest held by a management body to be perpetual (Điều 171 khoản 3)', () => {
      expect(
        resolveTenureType('RSX', TenureType.PERPETUAL, { landUserType: LandUserType.TCN }),
      ).toBe(TenureType.PERPETUAL);

      // An economic organisation producing on forest land is a ≤50-year grant
      // under Điều 172 khoản 1 điểm b, not "quản lý" — so no perpetual.
      expect(() =>
        resolveTenureType('RSX', TenureType.PERPETUAL, { landUserType: LandUserType.TKT }),
      ).toThrow(/not lawful/);

      // …nor for an individual, who gets the 50-year term of Điều 172.
      expect(() =>
        resolveTenureType('RSX', TenureType.PERPETUAL, { landUserType: LandUserType.CNV }),
      ).toThrow(/not lawful/);
    });

    it('makes community land perpetual only for cultural preservation (Điều 178 khoản 4)', () => {
      expect(
        resolveTenureType('CLN', TenureType.PERPETUAL, {
          landUserType: LandUserType.CDS,
          culturalPreservation: true,
        }),
      ).toBe(TenureType.PERPETUAL);

      // Community tenure on its own is an ordinary agricultural term.
      expect(() =>
        resolveTenureType('CLN', TenureType.PERPETUAL, { landUserType: LandUserType.CDS }),
      ).toThrow(/not lawful/);
      expect(() => resolveTenureType('CLN', TenureType.PERPETUAL)).toThrow(/not lawful/);
    });

    it('still rejects a tenure that is unlawful for the code', () => {
      // Residential land is never a project lease.
      expect(() => resolveTenureType('ONT', TenureType.PROJECT_LEASEHOLD)).toThrow(/not lawful/);
      expect(() => resolveTenureType('SKK', TenureType.PERPETUAL)).toThrow(/not lawful/);
    });

    it('widens the allowed set only when the circumstances match', () => {
      expect(allowedTenures('RSX')).toEqual([TenureType.FIXED_TERM]);
      expect(allowedTenures('RSX', { landUserType: LandUserType.TSN })).toContain(
        TenureType.PERPETUAL,
      );
      expect(allowedTenures('RSX', { landUserType: LandUserType.CNV })).not.toContain(
        TenureType.PERPETUAL,
      );
    });

    it('keeps the 50-year rule to the categories Điều 172 khoản 1 điểm a lists', () => {
      for (const code of ['LUC', 'LUK', 'CLN', 'HNK', 'NTS', 'LMU', 'RSX']) {
        expect(hasStatutoryFiftyYearTerm(code)).toBe(true);
      }
      // CNT is a category Luật 2024 created in Điều 9 and điểm a does not list;
      // RSN is natural forest, while điểm a says "rừng sản xuất là rừng trồng".
      expect(hasStatutoryFiftyYearTerm('CNT')).toBe(false);
      expect(hasStatutoryFiftyYearTerm('RSN')).toBe(false);
    });

    it('separates planted from natural production forest', () => {
      expect(landUseCodeLabel('RSX')).toBe('Đất rừng sản xuất là rừng trồng');
      expect(landUseCodeLabel('RSN')).toBe('Đất rừng sản xuất là rừng tự nhiên');
    });
  });
});
