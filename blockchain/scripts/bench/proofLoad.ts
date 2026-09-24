/**
 * scripts/bench/proofLoad.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Measure `GET /api/proof/:propertyId` under load on a 2.5M-plot registry —
 * DoD #3 of the D72 spec, and the "server load" figure of Chapter 5.
 *
 * Two modes:
 *   ETAG=0 (default) — every request is a full 200: TREE_DEPTH key lookups plus
 *                      TREE_DEPTH Poseidon hashes, plus one cached root read.
 *   ETAG=1           — the client presents the ETag it was given, so the server
 *                      answers 304 after ONE primary-key read and does no
 *                      hashing (D74). The gap between the two modes is the load
 *                      a CDN would absorb.
 *
 * ⚠️ The route sits on the shared 60/minute throttle bucket (D74). Run the
 * backend with `THROTTLE_LIMIT=1000000`, or this measures the throttle instead
 * of the server. The `statuses` line in the output must contain no 429.
 *
 * ⚠️ The sample is SAMPLE distinct propertyIds, not all 2.5 million. Enough
 * that no per-row cache anywhere is doing the work, but the report has to say
 * so rather than imply full coverage.
 *
 * Usage:
 *   API_BASE=http://localhost:3005/api CONCURRENCY=50 REQUESTS=5000 \
 *     pnpm --filter blockchain run bench:proof-load
 */
import { percentiles, writeBenchReport } from './lib/stats';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3001/api';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);
const REQUESTS = Number(process.env.REQUESTS ?? 5_000);
const SAMPLE = Number(process.env.SAMPLE ?? 2_000);
const USE_ETAG = process.env.ETAG === '1';

/** `PageResult<T> = { total, items }` — see backend/src/common/pagination.ts. */
interface PageResult<T> {
  total: number;
  items: T[];
}

async function sampleIds(): Promise<string[]> {
  const first = await fetch(`${API_BASE}/records?take=1`);
  if (!first.ok) throw new Error(`GET /records → ${first.status}`);
  const { total } = (await first.json()) as PageResult<unknown>;
  if (!total) throw new Error('the registry is empty — run bench:seed first');

  const ids: string[] = [];
  const pages = Math.ceil(SAMPLE / 200);
  for (let page = 0; page < pages; page++) {
    // Spread the pages across the whole register rather than taking the first
    // SAMPLE rows, so the sample is not one contiguous corner of the tree.
    const skip = Math.floor((total / pages) * page);
    const res = await fetch(`${API_BASE}/records?take=200&skip=${skip}`);
    if (!res.ok) throw new Error(`GET /records?skip=${skip} → ${res.status}`);
    const body = (await res.json()) as PageResult<{ propertyId: string }>;
    ids.push(...body.items.map((item) => item.propertyId));
  }
  return ids.slice(0, SAMPLE);
}

async function main(): Promise<void> {
  const ids = await sampleIds();
  console.log(
    `  ${ids.length} distinct plot(s) sampled; ${REQUESTS} request(s) at concurrency ${CONCURRENCY}` +
      `${USE_ETAG ? ', conditional (expecting 304)' : ''}`,
  );

  // Conditional mode needs a validator per plot first, from a normal 200.
  const etags = new Map<string, string>();
  if (USE_ETAG) {
    for (const id of ids) {
      const res = await fetch(`${API_BASE}/proof/${id}`);
      const etag = res.headers.get('etag');
      if (etag) etags.set(id, etag);
    }
    console.log(`  primed ${etags.size} validator(s)`);
  }

  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  let issued = 0;

  const startedAt = Date.now();
  const worker = async (): Promise<void> => {
    for (;;) {
      const n = issued++;
      if (n >= REQUESTS) return;
      const id = ids[n % ids.length];

      const requestStart = Date.now();
      const res = await fetch(`${API_BASE}/proof/${id}`, {
        headers: USE_ETAG && etags.has(id) ? { 'if-none-match': etags.get(id)! } : {},
      });
      // Drain the body: a request is not finished until its payload is read.
      await res.arrayBuffer();
      latencies.push(Date.now() - requestStart);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const wallMs = Date.now() - startedAt;

  const stats = percentiles(latencies);
  const report = {
    kind: 'proof-load',
    mode: USE_ETAG ? 'etag-304' : 'full-200',
    concurrency: CONCURRENCY,
    requests: REQUESTS,
    distinctIds: ids.length,
    wallMs,
    requestsPerSecond: Number(((REQUESTS / wallMs) * 1000).toFixed(1)),
    latencyMs: stats,
    statuses: Object.fromEntries(statuses),
  };
  const file = writeBenchReport(`proof-load-${report.mode}`, report);

  console.log('');
  console.log(`  req/s     : ${report.requestsPerSecond}`);
  console.log(`  latency   : p50 ${stats.p50} / p95 ${stats.p95} / p99 ${stats.p99} ms (max ${stats.max})`);
  console.log(`  statuses  : ${JSON.stringify(report.statuses)}`);
  console.log(`  report    : ${file}`);

  if (statuses.has(429)) {
    console.log('');
    console.log('  !! 429 seen — this measured the throttle, not the server.');
    console.log('     Restart the backend with THROTTLE_LIMIT=1000000 and run again.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
