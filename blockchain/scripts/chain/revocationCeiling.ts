// Worst-case revocation ceiling of a live deployment, and whether CAP stays 50 plots under it (D91).
// estimateGas only. Usage: CAP=989 pnpm --filter blockchain run chain:revocation-ceiling:sepolia
import { ethers, network } from 'hardhat';

import { loadDeployment } from '../../shared/deployments';
import { BLOCKCHAIN_DIR } from '../lib/paths';

const HEADROOM = 50;
// geth's txpool refuses transactions over 128 KB, which caps a round near here whatever the gas.
const MAX_BY_TX_SIZE = 1_360;

async function main() {
  const deployment = loadDeployment(BLOCKCHAIN_DIR, network.name);
  const registry = await ethers.getContractAt('RootRegistry', deployment.contracts.RootRegistry);
  const from = deployment.authority.address;
  const root = ethers.keccak256(ethers.toUtf8Bytes(`ceiling-${Date.now()}`)); // never latestRoot
  const detail = ethers.keccak256(ethers.toUtf8Bytes('ceiling'));

  // Top words of the 2^24 id space (D71): no certificate uses them, so every bit opens a slot.
  const estimate = (n: number) => {
    const ids = Array.from({ length: n }, (_, i) => BigInt(65_535 - i) * 256n + 7n);
    return registry.publishRootWithRevocations.estimateGas(
      root,
      ids,
      ids.map(() => 1),
      ids.map(() => detail),
      { from },
    );
  };

  const base = await estimate(0); // throws with the node's reason if even a bare publish fails
  let ceiling = 0;
  let hi = MAX_BY_TX_SIZE;
  while (ceiling < hi) {
    const mid = Math.ceil((ceiling + hi) / 2);
    const fits = await estimate(mid).then(
      () => true,
      () => false,
    );
    if (fits) ceiling = mid;
    else hi = mid - 1;
  }
  const perPlot =
    ceiling > 0 ? (Number((await estimate(ceiling)) - base) / ceiling).toFixed(0) : '-';

  console.log(`${network.name} RootRegistry ${deployment.contracts.RootRegistry}`);
  console.log(`  worst-case ceiling: ${ceiling} revocations/tx (${perPlot} gas each)`);
  console.log(`  REVOCATION_CAP ≤ ${ceiling - HEADROOM}`);

  if (process.env.CAP) {
    const cap = Number(process.env.CAP);
    const ok = Number.isSafeInteger(cap) && cap > 0 && cap + HEADROOM <= ceiling;
    console.log(`  CAP=${process.env.CAP}: ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
