/**
 * scripts/tree-bootstrap.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Rebuild the whole of `merkle_nodes` from the ISSUED plots (D72).
 *
 * Run it when:
 *   - TREE_DEPTH changed (D71) — every stored node belongs to the old shape;
 *   - a bench genesis was just seeded;
 *   - `GET /api/proof/:id` reports that the rows and the tree have diverged.
 *
 * ⚠️ TRUNCATEs and rebuilds. While it runs the tree cannot answer correctly, so
 * do not run it against a serving deployment. It writes nothing on-chain and
 * touches no `Property` row, so running it twice is harmless.
 *
 * ⚠️ The root it prints is NOT published. Publishing is signed in the officer's
 * wallet (D43); `sign:root` is the stand-in for that wallet in development.
 *
 * Usage: pnpm --filter backend run tree:bootstrap
 */
import * as path from 'path';

import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';

// Same two-step load as scripts/seed-admin-units.ts: the backend's own .env
// first, then the monorepo root's. Resolved from __dirname, not cwd, so the
// script works whichever directory it is invoked from.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

import { AppModule } from '../src/app.module';
import { NodeStoreService } from '../src/tree/node-store.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { abortOnError: false });
  const nodes = app.get(NodeStoreService);

  const startedAt = Date.now();
  const result = await nodes.bootstrap((stage, count) => {
    console.log(`  ${stage}: ${count.toLocaleString('en-US')} node(s)`);
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('');
  console.log(`  leaves : ${result.leaves.toLocaleString('en-US')}`);
  console.log(`  nodes  : ${result.nodes.toLocaleString('en-US')}`);
  console.log(`  root   : ${result.root}`);
  console.log(`  elapsed: ${seconds}s`);
  console.log('');
  console.log('  This root is NOT published yet. Sign it in the officer wallet (D43), or:');
  console.log(`    NEW_ROOT=${result.root} pnpm --filter blockchain run sign:root`);

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
