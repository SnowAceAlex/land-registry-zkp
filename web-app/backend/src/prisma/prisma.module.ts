import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule
 * ─────────────────────────────────────────────────────────────────────────────
 * A global NestJS module that provides PrismaService to the entire application.
 *
 * Marked @Global() so feature modules (RecordsModule, ChainModule, ProofModule)
 * do NOT need to individually import PrismaModule — they can inject PrismaService
 * directly as long as AppModule imports PrismaModule once.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
