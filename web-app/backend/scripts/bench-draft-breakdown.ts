// Splits createDraft() into its steps by timing the real methods in place (no product change).
// Needs a queued day: bench:month with STOP_BEFORE_DRAFT_DAY. Each run creates the draft and
// discards it again, so the queue is left as found. Variant "noIssuance" holds the READY issuance
// requests for its runs (heldAt) and releases them after, to isolate what re-issues cost.
// DATABASE_URL=$BENCH_DB RUNS=3 pnpm --filter backend exec ts-node scripts/bench-draft-breakdown.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

import { AppModule } from '../src/app.module';
import { Actor } from '../src/common/actor';
import { ChangeSetService } from '../src/government/changeset.service';
import { PrismaService } from '../src/prisma/prisma.service';

const RUNS = Number(process.env.RUNS ?? 3);
const ms = (start: bigint): number => Number(process.hrtime.bigint() - start) / 1e6;

type Timings = Record<string, number>;

/** Wraps obj[name] so every call adds its duration to timings[label]; sync and async alike. */
function timeMethod(obj: any, name: string, label: string, timings: () => Timings): void {
  const original = obj[name].bind(obj);
  obj[name] = (...args: unknown[]) => {
    const start = process.hrtime.bigint();
    const add = () => (timings()[label] = (timings()[label] ?? 0) + ms(start));
    const out = original(...args);
    if (out && typeof out.then === 'function') return out.finally(add);
    add();
    return out;
  };
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const changesets = app.get(ChangeSetService) as any;

  const hq = await prisma.landOffice.findUniqueOrThrow({ where: { code: 'HQ' } });
  const actor: Actor = {
    officeId: hq.id,
    officeCode: hq.code,
    officeName: hq.name,
    officeKind: hq.kind,
    scope: 'CENTRAL',
    credentialId: null,
  };

  let current: Timings = {};
  const now = () => current;
  timeMethod(changesets.lock, 'assertNoOpenDraft', 'assertNoOpenDraft', now);
  timeMethod(changesets, 'queue', 'readQueue', now);
  timeMethod(changesets, 'assertNoConflicts', 'conflictCheck', now);
  timeMethod(changesets, 'mismatchedCommitments', 'issuanceSecretCheck', now);
  timeMethod(changesets.lineage, 'assertPredecessorsRevoked', 'lineageCheck', now);
  timeMethod(changesets, 'leafUpdatesFor', 'leafUpdates', now);
  timeMethod(changesets.nodes, 'prefetchReader', 'projectRoot.readNodes', now);
  timeMethod(changesets.nodes, 'projectRoot', 'projectRoot', now);
  timeMethod(changesets, 'attachItems', 'attachItems', now);

  const runVariant = async (variant: string) => {
    const runs = [];
    for (let run = 1; run <= RUNS; run++) {
      current = {};
      const start = process.hrtime.bigint();
      const draft = await changesets.createDraft(actor);
      const totalMs = ms(start);
      await changesets.discard(draft.id);

      const steps = { ...current };
      steps['projectRoot.hash'] = steps.projectRoot - (steps['projectRoot.readNodes'] ?? 0);
      const measured = [
        'assertNoOpenDraft', 'readQueue', 'conflictCheck', 'issuanceSecretCheck',
        'lineageCheck', 'leafUpdates', 'projectRoot', 'attachItems',
      ].reduce((sum, key) => sum + (steps[key] ?? 0), 0);
      steps['other (lock, insert draft, tx)'] = totalMs - measured;
      const rounded = Object.fromEntries(
        Object.entries(steps).map(([key, value]) => [key, Math.round(value)]),
      );
      runs.push({
        run,
        totalMs: Math.round(totalMs),
        items: {
          issuances: draft.issuanceRequestIds.length,
          transfers: draft.transferIds.length,
          revocations: draft.revocationIds.length,
          deferredRevocations: draft.deferredRevocations,
        },
        stepsMs: rounded,
      });
      console.log(`  ${variant} run ${run}: ${Math.round(totalMs)} ms ${JSON.stringify(rounded)}`);
    }
    return runs;
  };

  const full = await runVariant('full');

  // shortcut: holds every READY issuance request, so run it only on a throwaway bench clone.
  const held = await prisma.issuanceRequest.updateMany({
    where: { status: 'READY', changeSetId: null, heldAt: null },
    data: { heldAt: new Date() },
  });
  let noIssuance;
  try {
    noIssuance = await runVariant('noIssuance');
  } finally {
    await prisma.issuanceRequest.updateMany({
      where: { status: 'READY', changeSetId: null },
      data: { heldAt: null },
    });
  }

  const report = {
    kind: 'draft-breakdown' as const,
    at: new Date().toISOString(),
    runs: RUNS,
    heldForNoIssuance: held.count,
    full,
    noIssuance,
    machine: { platform: process.platform, cpus: os.cpus().length, node: process.version },
  };
  const dir = path.resolve(
    __dirname, '..', '..', '..', 'blockchain', 'bench', 'results',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'draft-breakdown.json'), JSON.stringify(report, null, 2));
  console.log(`  report: ${dir}`);

  await app.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
