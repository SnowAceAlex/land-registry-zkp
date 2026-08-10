import { Module } from '@nestjs/common';

import { AdministrativeUnitsService } from './administrative-units.service';

/**
 * LandLawModule — the Vietnamese land-law rule layer.
 *
 * No controller: nothing here is an endpoint. It is the reference data and the
 * statutory rules that other modules validate against — which land-use codes
 * exist and what tenure each allows (Điều 171/172), which bodies may issue a
 * certificate (Điều 136 + NĐ 151/2025), and which commune-level units are in
 * force since 01/7/2025.
 *
 * Separated from `import/` because these rules outlive the CSV path that
 * currently consumes them: the transfer flow already reads `landUserType` rules,
 * and the government portal will need the code catalog for display. Keeping 800
 * lines of statute inside the importer made both harder to read than either is
 * on its own.
 *
 * ⚠️ D35 — nothing in here translates outdated input. A superseded land code or
 * a renamed agency is a plain invalid value, not something to repair.
 */
@Module({
  providers: [AdministrativeUnitsService],
  exports: [AdministrativeUnitsService],
})
export class LandLawModule {}
