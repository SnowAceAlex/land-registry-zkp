/**
 * signFreeze.ts - stand in for the officer's wallet on a freeze or unfreeze (D79/D80).
 *
 * Usage (from blockchain/):
 *   hardhat run scripts/tools/signFreeze.ts --network localhost
 *
 * Environment - exactly one of:
 *   FREEZE        JSON [{ "propertyId": "1001", "ownerCommitment": "..." }, ...]
 *   FREEZE_FILE   path to a file holding that JSON, for bulk (the bench)
 *   UNFREEZE      JSON ["1001", ...]
 */
import * as fs from 'fs';
import * as path from 'path';
import { ethers, network } from 'hardhat';

import { loadDeployment } from '../../shared/deployments';

const BLOCKCHAIN_DIR = path.resolve(__dirname, '../..');

/** Mirrors MAX_FREEZES_PER_TX in web-app/backend/src/freeze/freeze.service.ts. */
const MAX_FREEZES_PER_TX = 200;

interface FreezeArg {
  propertyId: string;
  ownerCommitment: string;
}

function readFreezes(): FreezeArg[] | null {
  if (process.env.FREEZE_FILE) {
    return JSON.parse(fs.readFileSync(process.env.FREEZE_FILE, 'utf8')) as FreezeArg[];
  }
  if (process.env.FREEZE) return JSON.parse(process.env.FREEZE) as FreezeArg[];
  return null;
}

async function main(): Promise<void> {
  const freezes = readFreezes();
  const unfreezes = process.env.UNFREEZE ? (JSON.parse(process.env.UNFREEZE) as string[]) : null;
  if ((freezes === null) === (unfreezes === null)) {
    throw new Error('Set exactly one of FREEZE, FREEZE_FILE or UNFREEZE');
  }

  const deployment = loadDeployment(BLOCKCHAIN_DIR, network.name);
  const registry = await ethers.getContractAt('RootRegistry', deployment.contracts.RootRegistry);

  const count = freezes ? freezes.length : unfreezes!.length;
  const txHashes: string[] = [];
  let gasUsed = 0n;

  for (let i = 0; i < count; i += MAX_FREEZES_PER_TX) {
    const tx = freezes
      ? await registry.freezeOwners(
          freezes.slice(i, i + MAX_FREEZES_PER_TX).map((f) => BigInt(f.propertyId)),
          freezes.slice(i, i + MAX_FREEZES_PER_TX).map((f) => BigInt(f.ownerCommitment)),
        )
      : await registry.unfreezeOwners(
          unfreezes!.slice(i, i + MAX_FREEZES_PER_TX).map((id) => BigInt(id)),
        );
    const receipt = await tx.wait();
    if (!receipt) throw new Error('sign:freeze: a transaction produced no receipt');

    txHashes.push(receipt.hash);
    gasUsed += receipt.gasUsed;
    const size = Math.min(MAX_FREEZES_PER_TX, count - i);
    console.log(
      `${freezes ? 'frozen  ' : 'unfrozen'}  ${size} plot(s)  tx ${receipt.hash}  gas ${receipt.gasUsed}`,
    );
  }

  // One machine-readable line for the bench harness, like sign:root's.
  console.log(
    `BENCH_RESULT ${JSON.stringify({ txCount: txHashes.length, gasUsed: gasUsed.toString(), txHashes })}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
