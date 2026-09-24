/**
 * scripts/bench/lib/stats.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Percentiles and report writing for the bench harness (Chapter 5).
 *
 * Nearest-rank rather than interpolated: with a few thousand latency samples the
 * two differ by nothing worth having, but nearest-rank always returns a REAL
 * measurement — so an odd number in the table can always be traced back to one
 * actual request.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BLOCKCHAIN_DIR } from '../../lib/paths';

export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
}

export function percentiles(samples: number[]): Percentiles {
  if (samples.length === 0) throw new Error('percentiles: no samples');

  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];

  return {
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    mean: Number((sorted.reduce((sum, v) => sum + v, 0) / sorted.length).toFixed(1)),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Write a report to `blockchain/bench/results/<timestamp>/<name>.json`.
 *
 * The machine block is not decoration: a latency figure without it cannot be
 * reproduced, and Chapter 5 has to say what it was measured on.
 */
export function writeBenchReport(name: string, payload: Record<string, unknown>): string {
  const dir = path.join(
    BLOCKCHAIN_DIR,
    'bench',
    'results',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        machine: {
          platform: process.platform,
          arch: process.arch,
          cpus: os.cpus().length,
          cpuModel: os.cpus()[0]?.model,
          totalMemGb: Math.round(os.totalmem() / 1024 ** 3),
          node: process.version,
        },
        ...payload,
      },
      null,
      2,
    ),
  );
  return file;
}
