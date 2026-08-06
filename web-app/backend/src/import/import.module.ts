import { Module } from '@nestjs/common';

import { ImportService } from './import.service';
import { LandLawModule } from '../land-law/land-law.module';

/**
 * ImportModule — bulk load of land records from an official CSV export.
 *
 * Exports the service without owning a route: the endpoint stays on
 * `GovernmentController` as `POST /api/government/import`, because bulk import
 * is something the state authority does and belongs on that portal's surface.
 * What lives here is the parsing and validation, which is substantial enough
 * (and legal enough) to deserve its own boundary.
 *
 * The statutory rules it validates against come from LandLawModule.
 */
@Module({
  imports: [LandLawModule],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
