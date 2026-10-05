/**
 * scripts/bench-replay-month.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Replay one month of HCMC paperwork through the real flow (D72, Chapter 5):
 * 65,868 transfers and 20,890 revocations, spread over 22 working days, batched
 * into change sets, signed by a wallet, confirmed.
 *
 * ⚠️ TWO ASSUMPTIONS THAT BELONG IN CHAPTER 5, not left for a reader to infer:
 *
 *  1. EVERY mutation is modelled as a TRANSFER. The system cannot yet express a
 *     mortgage registration (Future work of the D72 spec). This is a
 *     CONSERVATIVE upper bound: a transfer is the most expensive change there
 *     is — it needs a ZK proof over two Merkle paths — whereas an in-place
 *     change would be one leaf, one field, and no proof at all.
 *
 *  2. The transfer PROOFS are skipped for all but a handful. One transfer proof
 *     takes ~1.7s, so 65,868 of them is ~31 CPU-hours — and that is a CLIENT
 *     cost (the officer's browser at the counter, D47), not the server cost
 *     this script measures. `bench:prove` measures one proof properly and the
 *     report multiplies. Everything from `POST /changesets` onward is the real
 *     flow with no shortcut.
 *
 * ⚠️ POINT IT AT THE BENCH DATABASE AND A LOCAL CHAIN. It writes directly into
 * `transfer_requests` and publishes roots.
 *
 *   export BENCH_DB="postgresql://postgres:postgres@localhost:5433/land_registry_bench?schema=public"
 *   # backend, in its own terminal:
 *   DATABASE_URL=$BENCH_DB CHAIN_NETWORK=localhost THROTTLE_LIMIT=1000000 pnpm run dev:backend
 *   # then:
 *   DATABASE_URL=$BENCH_DB GOV_API_KEY=... pnpm --filter backend run bench:month
 *
 * Usage:
 *   TRANSFERS=65868 REVOCATIONS=20890 DAYS=22 pnpm --filter backend run bench:month
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

// From `bench-secret`, NOT from `bench-seed-genesis`: the seeder imports
// AppModule at the top level, so importing it here would boot a second Nest
// context with its own RPC connection and database pool.
import { nextOwnerCommitment, nextOwnerSecret } from './bench-secret';

const TRANSFERS = Number(process.env.TRANSFERS ?? 65_868);
const REVOCATIONS = Number(process.env.REVOCATIONS ?? 20_890);
const DAYS = Number(process.env.DAYS ?? 22);
const API_BASE = process.env.API_BASE ?? 'http://localhost:3001/api';
const API_KEY = process.env.GOV_API_KEY ?? '';
const INSERT_CHUNK = 1_000;

/**
 * Which `sign:root` variant to run.
 *
 * ⚠️ `sign:root` is hardcoded to `--network localhost`. Running it while the
 * backend talks to Sepolia publishes the root to the WRONG CHAIN, and confirm()
 * then refuses the round — correctly, and confusingly, because the message says
 * the transaction "has not been mined" when in fact it was mined somewhere
 * else. The network has to be chosen here, from the same variable the backend
 * was started with.
 */
const SIGN_SCRIPT =
  (process.env.CHAIN_NETWORK ?? 'localhost') === 'sepolia' ? 'sign:root:sepolia' : 'sign:root';

interface DayResult {
  day: number;
  transfers: number;
  revocations: number;
  deferredRevocations: number;
  queueMs: number;
  draftMs: number;
  signMs: number;
  confirmMs: number;
  gasUsed: string;
  rootVersion: number;
  /**
   * Needed to reconstruct the real cost afterwards: `gasUsed × effectiveGasPrice`
   * only exists on the receipt, and on a public chain the receipt is the only
   * record of what was actually paid.
   */
  txHash: string;
}

/**
 * One HTTP call, retried once on a CONNECTION failure — never on an HTTP error.
 *
 * ⚠️ Why the retry is needed, and why it is not papering over anything: signing
 * a root runs `sign:root` through `execFileSync`, which blocks this process's
 * event loop for several seconds. Node's HTTP server closes an idle keep-alive
 * socket after 5s, so the connection pooled before the signature is already
 * dead when the confirm goes out, and the first write on it fails with
 * ECONNRESET. The server never saw the request. An HTTP status, by contrast, is
 * an answer and is never retried: a 409 means the queue is wrong and repeating
 * it would only hide that.
 */
async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  route: string,
  body?: unknown,
): Promise<T> {
  // node:http, not fetch: fetch gives up after 300s without headers, and a D77
  // confirm of ~3,000 transfers takes longer than that.
  const send = (): Promise<{ status: number; text: string }> =>
    new Promise((resolve, reject) => {
      const payload = method === 'GET' ? undefined : JSON.stringify(body ?? {});
      const req = http.request(
        `${API_BASE}${route}`,
        {
          method,
          headers: {
            'content-type': 'application/json',
            'x-gov-api-key': API_KEY,
            ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  let res: { status: number; text: string };
  try {
    res = await send();
  } catch {
    res = await send();
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method} ${route} → ${res.status} ${res.text.slice(0, 400)}`);
  }
  return (res.text ? JSON.parse(res.text) : undefined) as T;
}

const api = <T>(route: string, body?: unknown): Promise<T> => call<T>('POST', route, body);

/**
 * Put the queue back to empty, through the real API where one exists.
 *
 * Order matters and the reason is D44: an abandoned DRAFT change set still
 * `connect`s its transfers and revocations, so they are NOT unbatched and a
 * plain delete-where-changeSetId-is-null skips them — while `assertNoOpenDraft`
 * refuses to start the next round. So discard the open draft first (which
 * releases its rows), then clear whatever is left over.
 *
 * Only unbatched work is removed. Anything attached to a PUBLISHED change set
 * is history and stays.
 */
async function resetQueue(prisma: PrismaClient): Promise<void> {
  // The route wraps its answer: `{ draft: null }` when nothing is open (D53).
  const { draft } = await call<{ draft: { kind: string; id: number } | null }>(
    'GET',
    '/government/drafts/open',
  );
  if (draft) {
    const route = draft.kind === 'changeset' ? 'changesets' : 'issuance-batches';
    await call('DELETE', `/government/${route}/${draft.id}`);
    console.log(`  discarded an open ${draft.kind} draft (#${draft.id})`);
  }

  const transfers = await prisma.transferRequest.deleteMany({
    where: { changeSetId: null, status: { in: ['PENDING', 'APPROVED'] } },
  });
  const revocations = await prisma.revocation.deleteMany({
    where: { changeSetId: null, status: 'PENDING' },
  });
  if (transfers.count > 0 || revocations.count > 0) {
    console.log(
      `  cleared a stale queue: ${transfers.count} transfer(s), ${revocations.count} revocation(s)`,
    );
  }
}

/**
 * Sign a root with `sign:root` — the same officer-wallet stand-in development
 * already uses (D43). The backend still sends no transaction of its own.
 */
function signRoot(
  newRoot: string,
  revocations?: unknown,
): { txHash: string; gasUsed: string; rootVersion: number } {
  const out = execFileSync('pnpm', ['--filter', 'blockchain', 'run', SIGN_SCRIPT], {
    env: {
      ...process.env,
      NEW_ROOT: newRoot,
      ...(revocations ? { REVOCATIONS: JSON.stringify(revocations) } : {}),
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    // `shell: true` is required on Windows, where `pnpm` is a .cmd shim that
    // spawnSync cannot execute directly. Harmless elsewhere: every argument
    // here is a literal with no spaces or shell metacharacters.
    shell: true,
  });
  const line = out.split('\n').find((l) => l.startsWith('BENCH_RESULT '));
  if (!line) throw new Error(`sign:root printed no BENCH_RESULT line:\n${out}`);
  return JSON.parse(line.slice('BENCH_RESULT '.length));
}

async function main(): Promise<void> {
  if (!API_KEY) throw new Error('GOV_API_KEY is required — every government route is guarded');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  // This script writes transfer rows directly, bypassing the guard in
  // TransfersService.submit() that refuses a second request for one plot, so a
  // half-finished earlier run would make the next round fail for a reason that
  // has nothing to do with what is being measured.
  await resetQueue(prisma);

  const needed = TRANSFERS + REVOCATIONS;
  const pool_ = await prisma.property.findMany({
    where: { status: 'ISSUED' },
    // The current commitment is needed: the next owner is chained from it, so
    // that replaying against an already-replayed database still moves each leaf.
    select: { propertyId: true, ownerCommitment: true },
    orderBy: { id: 'asc' },
    take: needed,
  });
  if (pool_.length < needed) {
    throw new Error(
      `need ${needed} issued plots, found ${pool_.length} — run bench:seed against this database first`,
    );
  }

  const transferPool = pool_.slice(0, TRANSFERS);
  const revocationPool = pool_.slice(TRANSFERS);
  const perDayTransfers = Math.ceil(TRANSFERS / DAYS);
  const perDayRevocations = Math.ceil(REVOCATIONS / DAYS);

  console.log(
    `  replaying ${TRANSFERS.toLocaleString('en-US')} transfers + ` +
      `${REVOCATIONS.toLocaleString('en-US')} revocations over ${DAYS} working day(s), ` +
      `signing via ${SIGN_SCRIPT}`,
  );

  const days: DayResult[] = [];
  let peakRssMb = 0;

  for (let day = 0; day < DAYS; day++) {
    const todayTransfers = transferPool.slice(day * perDayTransfers, (day + 1) * perDayTransfers);
    const todayRevocations = revocationPool.slice(
      day * perDayRevocations,
      (day + 1) * perDayRevocations,
    );
    if (todayTransfers.length === 0 && todayRevocations.length === 0) break;

    // ── Queue the day's paperwork ────────────────────────────────────────────
    const queueStart = Date.now();

    // Transfers go straight in as APPROVED (see assumption 2). The new owner
    // commitment is REAL — the projected root has to be correct or confirm()
    // rejects the round, which would make the whole measurement meaningless.
    // Its secret is stored too: since D77 confirm() archives it for the buyer
    // and refuses a round that has none.
    const rows: Prisma.Sql[] = [];
    for (const { propertyId, ownerCommitment } of todayTransfers) {
      const secret = await nextOwnerSecret(ownerCommitment!);
      rows.push(Prisma.sql`(
        ${propertyId}, ${await nextOwnerCommitment(ownerCommitment!)}, ${secret.toString()},
        ${'0'}, ${'0'},
        ${'{}'}::jsonb, ${'[]'}::jsonb, ${'APPROVED'}::"TransferStatus",
        ${new Date().toISOString()}::timestamp
      )`);
    }
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO transfer_requests (
          "propertyId", "newOwnerCommitment", "newOwnerSecret", "oldRoot", "newRoot",
          "proof", "publicSignals", "status", "createdAt"
        ) VALUES ${Prisma.join(rows.slice(i, i + INSERT_CHUNK))}`,
      );
    }

    // Revocations go through the real endpoint — they are cheap and it keeps
    // the reason-code and detailHash logic in the measurement.
    for (const { propertyId } of todayRevocations) {
      await api('/government/revocations', {
        propertyId,
        reasonCode: 2,
        detailText: `bench replay, day ${day + 1}`,
      });
    }
    const queueMs = Date.now() - queueStart;

    // ── The real flow, with no shortcuts from here on ────────────────────────
    const draftStart = Date.now();
    const draft = await api<{
      id: number;
      newRoot: string;
      revocationCalldata: { propertyIds: string[]; reasonCodes: number[]; detailHashes: string[] };
      deferredRevocations: number;
    }>('/government/changesets');
    const draftMs = Date.now() - draftStart;

    const calldata = draft.revocationCalldata.propertyIds.map((propertyId, i) => ({
      propertyId,
      reasonCode: draft.revocationCalldata.reasonCodes[i],
      detailHash: draft.revocationCalldata.detailHashes[i],
    }));

    const signStart = Date.now();
    const signed = signRoot(draft.newRoot, calldata.length > 0 ? calldata : undefined);
    const signMs = Date.now() - signStart;

    const confirmStart = Date.now();
    await api(`/government/changesets/${draft.id}/confirm`, { txHash: signed.txHash });
    const confirmMs = Date.now() - confirmStart;

    peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / 1024 / 1024);

    days.push({
      day: day + 1,
      transfers: todayTransfers.length,
      revocations: calldata.length,
      deferredRevocations: draft.deferredRevocations,
      queueMs,
      draftMs,
      signMs,
      confirmMs,
      gasUsed: signed.gasUsed,
      rootVersion: signed.rootVersion,
      txHash: signed.txHash,
    });

    console.log(
      `  day ${day + 1}/${DAYS}: ${todayTransfers.length} transfer, ${calldata.length} revoke ` +
        `(${draft.deferredRevocations} deferred) — draft ${draftMs}ms, confirm ${confirmMs}ms, ` +
        `gas ${signed.gasUsed}`,
    );
  }

  const totalGas = days.reduce((sum, d) => sum + BigInt(d.gasUsed), 0n);
  const report = {
    kind: 'month' as const,
    at: new Date().toISOString(),
    assumptions: [
      'every mutation modelled as a transfer (conservative upper bound)',
      'transfer proofs measured separately by bench:prove, not generated here',
      'no per-procedure transaction: the lock is the open request row, enforced by the status attestation (D82)',
    ],
    transfers: TRANSFERS,
    revocations: REVOCATIONS,
    days: DAYS,
    publishes: days.length,
    totalGas: totalGas.toString(),
    peakRssMb: Math.round(peakRssMb),
    perDay: days,
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpus: require('os').cpus().length,
      totalMemGb: Math.round(require('os').totalmem() / 1024 ** 3),
      node: process.version,
    },
  };

  const dir = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'blockchain',
    'bench',
    'results',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'month.json'), JSON.stringify(report, null, 2));

  const confirmTimes = days.map((d) => d.confirmMs).sort((a, b) => a - b);
  console.log('');
  console.log(`  publishes : ${days.length}`);
  console.log(`  total gas : ${totalGas.toLocaleString('en-US')}`);
  console.log(
    `  confirm   : p50 ${confirmTimes[Math.floor(confirmTimes.length * 0.5)]}ms, ` +
      `max ${confirmTimes[confirmTimes.length - 1]}ms`,
  );
  console.log(`  peak RSS  : ${Math.round(peakRssMb)} MB`);
  console.log(`  report    : ${dir}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
