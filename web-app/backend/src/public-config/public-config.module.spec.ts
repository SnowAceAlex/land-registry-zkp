import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { PublicConfigController } from './public-config.controller';
import { PublicConfigService } from './public-config.service';

/**
 * public-config.module.spec.ts — the DI wiring check.
 *
 * `@nestjs/testing` is not installed, so this uses the documented alternative
 * (CLAUDE.md): `preview: true` resolves the whole provider graph WITHOUT
 * running `onModuleInit`, so no database and no chain are touched — but a
 * module missing from AppModule's `imports`, or a provider missing from its
 * own module, still fails here.
 *
 * Verified to actually catch it: removing `PublicConfigModule` from AppModule
 * makes the `get(PublicConfigService)` assertion throw.
 */
describe('PublicConfigModule wiring', () => {
  it('resolves through AppModule without a database or a chain', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, {
      preview: true,
      abortOnError: false,
      logger: false,
    });

    try {
      expect(app.get(PublicConfigService, { strict: false })).toBeInstanceOf(PublicConfigService);
      expect(app.get(PublicConfigController, { strict: false })).toBeInstanceOf(
        PublicConfigController,
      );
    } finally {
      await app.close();
    }
  });
});
