/**
 * scripts/bench/treeCheck.ts — is the stored tree right at scale? (G4)
 *
 * For a sample of plots, asks the backend for the Merkle proof and recomputes the root with the
 * shared verifier, against `latestRoot` read from the contract itself. Also checks the record's
 * public leaf, the D41 index binding (path bits = propertyId), and that a revoked plot answers 410.
 *
 *   API_BASE=http://localhost:3001/api SAMPLE=2000 EXTRA_IDS_FILE=ids.txt \
 *     pnpm --filter blockchain exec ts-node scripts/bench/treeCheck.ts
 *
 * EXTRA_IDS_FILE: optional, one propertyId per line (e.g. plots changed in the month), checked too.
 */
import * as fs from 'fs';

import { ethers } from 'ethers';

import { loadDeployment, resolveRpcUrl } from '../../shared/deployments';
import { verifyMerkleProof } from '../../shared/merkleTree';
import type { MerkleProofData } from '../../shared/types';
import { RootRegistry__factory } from '../../typechain-types';
import { BLOCKCHAIN_DIR } from '../lib/paths';
import { writeBenchReport } from './lib/stats';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3001/api';
const SAMPLE = Number(process.env.SAMPLE ?? 2_000);
const NETWORK = process.env.CHAIN_NETWORK ?? 'localhost';

interface RecordRow {
  propertyId: string;
  status: string;
  leaf: string | null;
}

async function getJson(route: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_BASE}${route}`);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function sample(): Promise<RecordRow[]> {
  const { body: first } = await getJson('/records?take=1');
  const total: number = first.total;
  const rows: RecordRow[] = [];
  const pages = Math.ceil(SAMPLE / 200);
  // Pages spread over the whole register, as in proofLoad.ts.
  for (let page = 0; page < pages; page++) {
    const skip = Math.floor((total / pages) * page);
    const { body } = await getJson(`/records?take=200&skip=${skip}`);
    rows.push(...body.items);
  }
  return rows.slice(0, SAMPLE);
}

async function main(): Promise<void> {
  const deployment = loadDeployment(BLOCKCHAIN_DIR, NETWORK);
  const provider = new ethers.JsonRpcProvider(resolveRpcUrl(NETWORK));
  const registry = RootRegistry__factory.connect(deployment.contracts.RootRegistry, provider);
  const latestRoot = BigInt(await registry.latestRoot());

  const rows = await sample();
  const extra = process.env.EXTRA_IDS_FILE
    ? fs.readFileSync(process.env.EXTRA_IDS_FILE, 'utf8').split(/\s+/).filter(Boolean)
    : [];
  for (const id of extra) {
    const { status, body } = await getJson(`/records/${id}`);
    if (status === 200) rows.push(body);
  }

  const tally: Record<string, number> = {};
  const failures: { propertyId: string; reason: string }[] = [];
  const bump = (key: string) => (tally[key] = (tally[key] ?? 0) + 1);
  const fail = (propertyId: string, reason: string) => {
    failures.push({ propertyId, reason });
    bump('fail');
  };

  for (const row of rows) {
    const { status, body } = await getJson(`/proof/${row.propertyId}`);
    bump(`${row.status}:http${status}`);
    if (row.status !== 'ISSUED') {
      if (row.status === 'REVOKED' && status !== 410) fail(row.propertyId, `revoked plot answered ${status}`);
      continue;
    }
    if (status !== 200) {
      fail(row.propertyId, `issued plot answered ${status}`);
      continue;
    }
    const proof: MerkleProofData = {
      leaf: BigInt(body.leaf),
      siblings: (body.siblings as string[]).map(BigInt),
      pathIndices: (body.pathIndices as number[]).map(Number),
      root: BigInt(body.merkleRoot),
    };
    // bench:seed writes rows by SQL without the `leaf` column; only rows a round touched carry one.
    if (row.leaf === null) bump('recordLeafNull');
    else if (row.leaf !== body.leaf) fail(row.propertyId, 'proof leaf differs from the public record leaf');
    else bump('recordLeafMatches');
    const index = proof.pathIndices.reduce((sum, bit, i) => sum + (BigInt(bit) << BigInt(i)), 0n);
    if (index !== BigInt(row.propertyId)) fail(row.propertyId, `path bits encode ${index}, not the propertyId`);
    if (BigInt(body.merkleRoot) !== latestRoot) fail(row.propertyId, 'proof root is not the chain latestRoot');
    if (!(await verifyMerkleProof(proof, latestRoot))) fail(row.propertyId, 'siblings do not hash to latestRoot');
    else bump('verified');
  }

  // A propertyId with no row must not get a proof.
  const missing = await getJson('/proof/16777214');
  tally[`missingId:http${missing.status}`] = 1;

  const report = {
    kind: 'tree-check',
    at: new Date().toISOString(),
    network: NETWORK,
    latestRoot: latestRoot.toString(),
    checked: rows.length,
    sampled: SAMPLE,
    extraIds: extra.length,
    tally,
    failures: failures.slice(0, 50),
  };
  const dir = writeBenchReport('tree-check', report);
  console.log(JSON.stringify(report, null, 2));
  console.log(`  report: ${dir}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
