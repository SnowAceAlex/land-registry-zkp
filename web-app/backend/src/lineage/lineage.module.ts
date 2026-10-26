import { Module } from '@nestjs/common';

import { LineageService } from './lineage.service';

/** Which certificate replaced which (D90); written at import, read by the portal. */
@Module({
  providers: [LineageService],
  exports: [LineageService],
})
export class LineageModule {}
