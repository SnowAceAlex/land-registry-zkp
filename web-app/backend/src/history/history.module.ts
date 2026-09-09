import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { HistoryController } from './history.controller';
import { PropertyEventService } from './property-event.service';

@Module({
  imports: [PrismaModule],
  controllers: [HistoryController],
  providers: [PropertyEventService],
  exports: [PropertyEventService],
})
export class HistoryModule {}
