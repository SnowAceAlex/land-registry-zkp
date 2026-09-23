import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ChainModule } from './chain/chain.module';
import { GovernmentModule } from './government/government.module';
import { HistoryModule } from './history/history.module';
import { ImportModule } from './import/import.module';
import { IssuanceModule } from './issuance/issuance.module';
import { LandLawModule } from './land-law/land-law.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProofModule } from './proof/proof.module';
import { PublicConfigModule } from './public-config/public-config.module';
import { RecordsModule } from './records/records.module';
import { TransfersModule } from './transfers/transfers.module';
import { TreeModule } from './tree/tree.module';

/**
 * Root application module.
 * Imports all feature modules.
 *
 * PrismaModule is @Global(), so PrismaService is available everywhere
 * without re-importing PrismaModule in each feature module.
 *
 * `ThrottlerModule` is registered globally (via the `APP_GUARD` below) so a
 * new controller is rate-limited by default rather than by remembering to add
 * a guard. There was no rate limiting at all before this: `GET /api/records`
 * and `GET /api/proof/:propertyId` were unauthenticated *and* unthrottled, so
 * nothing stood between a script and a full-registry scrape at wire speed.
 *
 * One named throttler, `default`: 60 requests/minute per IP (1/sec) is loose
 * enough that a person clicking around the resident portal never notices it,
 * but tight enough that scraping the addressable property range
 * (`MAX_PROPERTY_ID`, D41/D71) one request at a time is impractical.
 *
 * `ProofController` no longer has a bucket of its own. Its old 12/minute limit
 * existed because a cache miss there rebuilt the entire Merkle tree (D40) — the
 * most expensive operation any public route could trigger. Since D72 that route
 * is TREE_DEPTH key lookups, and since D74 a 304 touches no table at all, so it
 * is back on the shared 60/minute bucket. Being able to relax that limit is a
 * MEASURED consequence of D72, not a claim.
 *
 * `GovernmentController` opts out entirely with `@SkipThrottle()`: those routes
 * already sit behind `ApiKeyGuard`, and a legitimate bulk CSV import or a
 * multi-property issuance batch can easily exceed 60 requests/minute —
 * throttling an authenticated officer would only get in the way of the bulk
 * operations this system exists to support.
 *
 * `PublicConfigModule` adds the one other unguarded route, `GET
 * /api/public/config` (D58): the chain id and contract addresses the
 * logged-out resident portal needs to read the registry for itself. It keeps
 * the global 60/minute bucket — one small read per page load.
 */
/**
 * Requests per minute per IP on the shared bucket.
 *
 * `THROTTLE_LIMIT` raises it FOR MEASUREMENT ONLY (`bench:proof-load`, D72
 * DoD #3): a load test run under a 60/minute ceiling measures the ceiling, not
 * the server. Never set it in a real deployment — it is the only thing standing
 * between a script and a sweep of the whole propertyId range.
 */
const THROTTLE_LIMIT = Number(process.env.THROTTLE_LIMIT ?? 60);

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: THROTTLE_LIMIT }]),
    PrismaModule,
    TreeModule,
    ChainModule,
    LandLawModule,
    ImportModule,
    IssuanceModule,
    GovernmentModule,
    TransfersModule,
    RecordsModule,
    ProofModule,
    HistoryModule,
    PublicConfigModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
