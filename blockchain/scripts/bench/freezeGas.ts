// Gas of the D79 freeze register by batch size: fresh vs overwritten slots, unfreeze, and
// the frozenOwnersOf read. Own in-process deployment. `pnpm --filter blockchain run bench:freeze-gas`
import { ethers } from 'hardhat';

import { writeBenchReport } from './lib/stats';

const SIZES = [1, 10, 50, 100, 150, 200];
const ESTIMATE_SIZES = [300, 400, 500, 600, 650, 680, 700];
const ESTIMATE_CAP = 16_777_216n; // eth_estimateGas ceiling measured on Sepolia (2^24)
const BN254_P = 21888242871839275222246405745257275088548364400416300476201835965763879903617n;

// Real-shaped calldata: bench ids (stride 3 over 2^24) and full-width commitments,
// since calldata costs 16 gas per non-zero byte.
let nextId = 1n;
const ids = (n: number): bigint[] => Array.from({ length: n }, () => (nextId += 3n));
const commitments = (n: number): bigint[] =>
  Array.from({ length: n }, () => BigInt(ethers.hexlify(ethers.randomBytes(32))) % BN254_P || 1n);

async function main(): Promise<void> {
  const [admin] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory('RootRegistry')).deploy(admin.address);
  await registry.registerAuthority(admin.address, ethers.keccak256(ethers.toUtf8Bytes('bench')));

  const rows: {
    n: number;
    freezeFresh: string;
    freezeOverwrite: string;
    unfreeze: string;
    perPlotFresh: number;
    perPlotOverwrite: number;
  }[] = [];

  for (const n of SIZES) {
    const batch = ids(n);
    const fresh = await (await registry.freezeOwners(batch, commitments(n))).wait();
    // A transferred plot keeps its old entry, so its next freeze overwrites a non-zero slot.
    const overwrite = await (await registry.freezeOwners(batch, commitments(n))).wait();
    const lift = await (await registry.unfreezeOwners(batch)).wait();
    rows.push({
      n,
      freezeFresh: fresh!.gasUsed.toString(),
      freezeOverwrite: overwrite!.gasUsed.toString(),
      unfreeze: lift!.gasUsed.toString(),
      perPlotFresh: Math.round(Number(fresh!.gasUsed) / n),
      perPlotOverwrite: Math.round(Number(overwrite!.gasUsed) / n),
    });
  }
  console.table(rows);

  // Marginal cost from the two ends of the ladder: gas(n) ≈ base + n × marginal.
  const first = rows[0];
  const last = rows[rows.length - 1];
  const marginal = (a: string, b: string): number => (Number(b) - Number(a)) / (last.n - first.n);
  const marginalFresh = marginal(first.freezeFresh, last.freezeFresh);
  const marginalOverwrite = marginal(first.freezeOverwrite, last.freezeOverwrite);
  const baseFresh = Number(first.freezeFresh) - marginalFresh;
  const maxUnderCap = Math.floor((Number(ESTIMATE_CAP) - baseFresh) / marginalFresh);

  const estimates: { n: number; gas: string | null; underCap: boolean | null }[] = [];
  for (const n of ESTIMATE_SIZES) {
    try {
      const gas = await registry.freezeOwners.estimateGas(ids(n), commitments(n));
      estimates.push({ n, gas: gas.toString(), underCap: gas <= ESTIMATE_CAP });
    } catch {
      estimates.push({ n, gas: null, underCap: null });
    }
  }
  console.table(estimates);

  // The D80 queue check: one eth_call per 1,000 ids (FROZEN_READ_CHUNK). Free, but not zero work.
  const readGas = await registry.frozenOwnersOf.estimateGas(ids(1000));

  const file = writeBenchReport('freeze-gas', {
    kind: 'freeze-gas',
    network: 'hardhat (in-process)',
    ladder: rows,
    marginalFresh: Math.round(marginalFresh),
    marginalOverwrite: Math.round(marginalOverwrite),
    baseFresh: Math.round(baseFresh),
    maxBatchUnderEstimateCap: maxUnderCap,
    estimates,
    frozenOwnersOf1000Gas: readGas.toString(),
  });

  console.log(`  marginal fresh     : ${Math.round(marginalFresh)} gas/plot`);
  console.log(`  marginal overwrite : ${Math.round(marginalOverwrite)} gas/plot`);
  console.log(`  max batch < 2^24   : ${maxUnderCap}`);
  console.log(`  frozenOwnersOf(1000): ${readGas} gas (eth_call)`);
  console.log(`  report             : ${file}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
