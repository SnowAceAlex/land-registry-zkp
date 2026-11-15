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
// Resume a run stopped mid-month (1-based): keeps the queue, signs the open draft first.
const RESUME_FROM_DAY = Number(process.env.RESUME_FROM_DAY ?? 0);
// D83: a re-issue is revoke + issue under a new id; day d issues the replacements of day d-1's revocations.
const REISSUE = process.env.REISSUE !== '0';
// Follow-on rounds per day while revocations are deferred by the cap (D84 "Tạo đợt tiếp").
const MAX_ROUNDS_PER_DAY = 10;
// A replacement sits at revoked id + offset; contiguous layouts need an offset past the last id.
const SUCCESSOR_OFFSET = BigInt(process.env.SUCCESSOR_OFFSET ?? 1);
// Queue day N (1-based) and exit before its draft, leaving a real queue for bench:draft-breakdown.
const STOP_BEFORE_DRAFT_DAY = Number(process.env.STOP_BEFORE_DRAFT_DAY ?? 0);

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
  issuances: number;
  /** Rounds published this day: more than one when the revocation cap deferred some. */
  rounds: number;
  queueMs: number;
  draftMs: number;
  signMs: number;
  confirmMs: number;
  gasUsed: string;
  rootVersion: number;
  txHashes: string[];
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
  const { draft } = await call<{ draft: { id: number } | null }>('GET', '/government/drafts/open');
  if (draft) {
    await call('DELETE', `/government/changesets/${draft.id}`);
    console.log(`  discarded an open change-set draft (#${draft.id})`);
  }

  const transfers = await prisma.transferRequest.deleteMany({
    where: { changeSetId: null, status: { in: ['PENDING', 'APPROVED'] } },
  });
  const revocations = await prisma.revocation.deleteMany({
    where: { changeSetId: null, status: 'PENDING' },
  });
  // A queued issuance would ride into the next round and skew what is measured (D84).
  const issuances = await prisma.issuanceRequest.deleteMany({
    where: { changeSetId: null, status: 'READY' },
  });
  if (transfers.count > 0 || revocations.count > 0 || issuances.count > 0) {
    console.log(
      `  cleared a stale queue: ${transfers.count} transfer(s), ${revocations.count} revocation(s), ` +
        `${issuances.count} issuance request(s)`,
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
  // Through a file: a full round's JSON (~100 KB at 950, D91) exceeds Windows' 32 KB env-var limit.
  const file = revocations ? path.join(os.tmpdir(), `bench-revocations-${process.pid}.json`) : null;
  if (file) fs.writeFileSync(file, JSON.stringify(revocations));
  const out = execFileSync('pnpm', ['--filter', 'blockchain', 'run', SIGN_SCRIPT], {
    env: {
      ...process.env,
      NEW_ROOT: newRoot,
      ...(file ? { REVOCATIONS_FILE: file } : {}),
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
  if (!RESUME_FROM_DAY) await resetQueue(prisma);

  const needed = TRANSFERS + REVOCATIONS;
  // On resume, plots revoked earlier this run still belong to the genesis pool.
  const statuses = RESUME_FROM_DAY ? ['ISSUED', 'REVOKED'] : ['ISSUED'];
  const [{ total }] = await prisma.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`SELECT count(*) AS total FROM properties
      WHERE status::text = ANY(${statuses}) AND "propertyId" NOT IN (SELECT "successorPropertyId" FROM property_lineage)`,
  );
  // Every step-th plot, so a day's changes are spread over the whole register as in a real city.
  // The current commitment is needed: the next owner is chained from it, so
  // that replaying against an already-replayed database still moves each leaf.
  const step = Math.max(1, Math.floor(Number(total) / needed));
  const pool_ = await prisma.$queryRaw<
    { propertyId: string; ownerCommitment: string | null; landOfficeId: number | null }[]
  >(
    Prisma.sql`SELECT "propertyId", "ownerCommitment", "landOfficeId" FROM (
      SELECT "propertyId", "ownerCommitment", "landOfficeId", row_number() OVER (ORDER BY id) - 1 AS rn
      FROM properties
      WHERE status::text = ANY(${statuses}) AND "propertyId" NOT IN (SELECT "successorPropertyId" FROM property_lineage)
    ) t WHERE rn % ${step} = 0 ORDER BY rn LIMIT ${needed}`,
  );
  if (pool_.length < needed) {
    throw new Error(
      `need ${needed} issued plots, found ${pool_.length} — run bench:seed against this database first`,
    );
  }

  // D86: every request row names the office that filed it; the bench files as HQ.
  const hq = await prisma.landOffice.findUnique({ where: { code: 'HQ' }, select: { id: true } });
  if (!hq) throw new Error('land office HQ is missing — apply the Phase 10 migrations first');

  // Revocations evenly interleaved with transfers; day d takes every DAYS-th item of each pool.
  const isRevocation = (i: number) =>
    Math.floor(((i + 1) * REVOCATIONS) / needed) > Math.floor((i * REVOCATIONS) / needed);
  const transferPool = pool_.filter((_, i) => !isRevocation(i));
  const revocationPool = pool_.filter((_, i) => isRevocation(i));
  const ofDay = <T>(pool: T[], day: number) => pool.filter((_, i) => i % DAYS === day);

  // Replacement certificates (D83/D90): a new IMPORTED plot at id+1 superseding each revoked one.
  // id+1 is free only with LAYOUT=scattered (else set SUCCESSOR_OFFSET); the guard below fails loudly.
  const successorOf = (propertyId: string) => (BigInt(propertyId) + SUCCESSOR_OFFSET).toString();
  if (REISSUE && !RESUME_FROM_DAY) {
    const successors = revocationPool.map((p) => successorOf(p.propertyId));
    const taken = await prisma.property.count({
      where: { propertyId: { in: successors }, status: { not: 'IMPORTED' } },
    });
    if (taken > 0) throw new Error(`REISSUE needs free ids at revoked id + ${SUCCESSOR_OFFSET}; ${taken} taken`);
    const nowIso = new Date().toISOString();
    for (let i = 0; i < revocationPool.length; i += INSERT_CHUNK) {
      const chunk = revocationPool.slice(i, i + INSERT_CHUNK);
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO properties (
          "propertyId", "useType", "validityPeriod", "encumbranceStatus", "tenureType", "landUseCode",
          "certificateSerial", "bookEntryNumber", "address", "area", "issuingAuthority", "issueDate",
          "status", "createdAt", "updatedAt", "landOfficeId"
        ) VALUES ${Prisma.join(
          chunk.map(({ propertyId, landOfficeId }) => {
            const id = successorOf(propertyId);
            // Same land, same branch: the replacement inherits the predecessor's office (D85/D88).
            return Prisma.sql`(${id}, ${'RESIDENTIAL'}::"UseType", ${'0'}, ${'FREE'}::"EncumbranceStatus",
              ${'PERPETUAL'}::"TenureType", ${'ONT'}, ${`BENCH-${id}`}, ${`BK-${id}`},
              ${`So ${id}, Phuong Sai Gon, Thanh pho Ho Chi Minh`}, ${'100.00'}::decimal,
              ${'Van phong Dang ky dat dai Thanh pho Ho Chi Minh'}, ${nowIso}::date,
              ${'IMPORTED'}::"PropertyStatus", ${nowIso}::timestamp, ${nowIso}::timestamp,
              ${landOfficeId}::integer)`;
          }),
        )} ON CONFLICT ("propertyId") DO NOTHING`,
      );
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO property_lineage ("predecessorPropertyId", "successorPropertyId") VALUES ${Prisma.join(
          chunk.map(({ propertyId }) => Prisma.sql`(${propertyId}, ${successorOf(propertyId)})`),
        )} ON CONFLICT DO NOTHING`,
      );
    }
    console.log(`  imported ${revocationPool.length} replacement plots (REISSUE)`);
  }

  console.log(
    `  replaying ${TRANSFERS.toLocaleString('en-US')} transfers + ` +
      `${REVOCATIONS.toLocaleString('en-US')} revocations over ${DAYS} working day(s), ` +
      `signing via ${SIGN_SCRIPT}`,
  );

  const days: DayResult[] = [];
  let peakRssMb = 0;

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

  // Rewritten after every day, so a run stopped early still leaves its days on disk.
  const writeReport = (): bigint => {
    const totalGas = days.reduce((sum, d) => sum + BigInt(d.gasUsed), 0n);
    const report = {
      kind: 'month' as const,
      at: new Date().toISOString(),
      assumptions: [
        'every mutation modelled as a transfer (conservative upper bound)',
        'transfer proofs measured separately by bench:prove, not generated here',
        'no per-procedure transaction: the lock is the open request row, enforced by the status attestation (D82)',
        'changed plots are every step-th plot of the register, so each day is spread over the whole id range',
        ...(REISSUE
          ? ['each revoked certificate is replaced the next day by a new one at id+1 with a lineage link (D83/D90)']
          : []),
        `follow-on rounds in the same day while the revocation cap defers some (max ${MAX_ROUNDS_PER_DAY})`,
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
    fs.writeFileSync(path.join(dir, 'month.json'), JSON.stringify(report, null, 2));
    return totalGas;
  };

  for (let day = Math.max(RESUME_FROM_DAY - 1, 0); day < DAYS; day++) {
    const resumeDraft =
      RESUME_FROM_DAY && day === RESUME_FROM_DAY - 1
        ? (
            await call<{
              draft: {
                id: number;
                newRoot: string;
                revocationCalldata: {
                  propertyIds: string[];
                  reasonCodes: number[];
                  detailHashes: string[];
                };
                deferredRevocations: number;
              } | null;
            }>('GET', '/government/drafts/open')
          ).draft
        : null;

    const todayTransfers = ofDay(transferPool, day);
    const todayRevocations = ofDay(revocationPool, day);
    const todayIssuances =
      REISSUE && day > 0 ? ofDay(revocationPool, day - 1).map((p) => successorOf(p.propertyId)) : [];
    if (todayTransfers.length === 0 && todayRevocations.length === 0) break;

    // ── Queue the day's paperwork ────────────────────────────────────────────
    const queueStart = Date.now();
    if (!resumeDraft) {
      // Transfers go straight in as APPROVED (see assumption 2). The new owner
      // commitment is REAL — the projected root has to be correct or confirm()
      // rejects the round, which would make the whole measurement meaningless.
      // Its secret is stored too: since D77 confirm() archives it for the buyer
      // and refuses a round that has none.
      const rows: Prisma.Sql[] = [];
      for (const { propertyId, ownerCommitment, landOfficeId } of todayTransfers) {
        const secret = await nextOwnerSecret(ownerCommitment!);
        rows.push(Prisma.sql`(
        ${propertyId}, ${await nextOwnerCommitment(ownerCommitment!)}, ${secret.toString()},
        ${'0'}, ${'0'},
        ${'{}'}::jsonb, ${'[]'}::jsonb, ${'APPROVED'}::"TransferStatus",
        ${new Date().toISOString()}::timestamp,
        ${hq.id}::integer, ${landOfficeId}::integer
      )`);
      }
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await prisma.$executeRaw(
          Prisma.sql`INSERT INTO transfer_requests (
          "propertyId", "newOwnerCommitment", "newOwnerSecret", "oldRoot", "newRoot",
          "proof", "publicSignals", "status", "createdAt", "officeId", "landOfficeId"
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

      // Replacement issuances through the real central-office route (max 500 per call).
      for (let i = 0; i < todayIssuances.length; i += 500) {
        await api('/government/issuance-requests', { propertyIds: todayIssuances.slice(i, i + 500) });
      }
    }
    const queueMs = resumeDraft ? 0 : Date.now() - queueStart;
    if (day + 1 === STOP_BEFORE_DRAFT_DAY) {
      console.log(`  day ${day + 1}: queued in ${queueMs}ms; stopping before the draft (STOP_BEFORE_DRAFT_DAY)`);
      break;
    }

    // ── The real flow, with no shortcuts from here on ────────────────────────
    // One closing session: rounds follow each other while the cap defers revocations.
    type Draft = {
      id: number;
      newRoot: string;
      revocationCalldata: { propertyIds: string[]; reasonCodes: number[]; detailHashes: string[] };
      deferredRevocations: number;
    };
    let draft: Draft | null = resumeDraft;
    let draftMs = 0, signMs = 0, confirmMs = 0, revoked = 0, rounds = 0, gas = 0n;
    let signed!: ReturnType<typeof signRoot>;
    const txHashes: string[] = [];
    do {
      const draftStart = Date.now();
      if (!draft || rounds > 0) draft = await api<Draft>('/government/changesets');
      draftMs += Date.now() - draftStart;

      const calldata = draft.revocationCalldata.propertyIds.map((propertyId, i) => ({
        propertyId,
        reasonCode: draft!.revocationCalldata.reasonCodes[i],
        detailHash: draft!.revocationCalldata.detailHashes[i],
      }));

      const signStart = Date.now();
      signed = signRoot(draft.newRoot, calldata.length > 0 ? calldata : undefined);
      signMs += Date.now() - signStart;

      const confirmStart = Date.now();
      await api(`/government/changesets/${draft.id}/confirm`, { txHash: signed.txHash });
      confirmMs += Date.now() - confirmStart;

      revoked += calldata.length;
      gas += BigInt(signed.gasUsed);
      txHashes.push(signed.txHash);
      rounds++;
    } while (draft.deferredRevocations > 0 && rounds < MAX_ROUNDS_PER_DAY);

    peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / 1024 / 1024);

    days.push({
      day: day + 1,
      transfers: todayTransfers.length,
      revocations: revoked,
      deferredRevocations: draft.deferredRevocations,
      issuances: todayIssuances.length,
      rounds,
      queueMs,
      draftMs,
      signMs,
      confirmMs,
      gasUsed: gas.toString(),
      rootVersion: signed.rootVersion,
      txHash: signed.txHash,
      txHashes,
    });

    console.log(
      `  day ${day + 1}/${DAYS}: ${todayTransfers.length} transfer, ${revoked} revoke, ` +
        `${todayIssuances.length} issue in ${rounds} round(s) (${draft.deferredRevocations} deferred) — ` +
        `queue ${queueMs}ms, draft ${draftMs}ms, confirm ${confirmMs}ms, gas ${gas}`,
    );
    writeReport();
  }

  const totalGas = writeReport();

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
