/**
 * signRoot.ts — stand in for the officer's browser wallet (D43).
 *
 * In the real system an officer signs `publishRoot` / `publishRootWithRevocations`
 * in Metamask, and the backend never holds a key that can write to the chain. This
 * script does the same call with the deployer key so the flow can be driven from a
 * terminal — a manual-runbook and smoke-test convenience, not part of the product.
 *
 * Usage (from blockchain/):
 *   hardhat run scripts/tools/signRoot.ts --network localhost
 *
 * Environment:
 *   NEW_ROOT       decimal string, taken from the draft response (required)
 *   REVOCATIONS    optional JSON: [{ propertyId, reasonCode, detailHash }, ...]
 *                  when present, calls publishRootWithRevocations instead
 */
import * as path from 'path';
import { ethers, network } from 'hardhat';

import { loadDeployment } from '../../shared/deployments';

const BLOCKCHAIN_DIR = path.resolve(__dirname, '../..');

interface RevocationArg {
  propertyId: string;
  reasonCode: number;
  detailHash: string;
}

async function main(): Promise<void> {
  const newRootDecimal = process.env.NEW_ROOT;
  if (!newRootDecimal) throw new Error('NEW_ROOT is required (decimal string from the draft)');

  const deployment = loadDeployment(BLOCKCHAIN_DIR, network.name);
  const registry = await ethers.getContractAt('RootRegistry', deployment.contracts.RootRegistry);

  // The tree works in field elements (decimal); the contract takes bytes32.
  const newRoot = ethers.zeroPadValue(ethers.toBeHex(BigInt(newRootDecimal)), 32);

  const revocations: RevocationArg[] = process.env.REVOCATIONS
    ? (JSON.parse(process.env.REVOCATIONS) as RevocationArg[])
    : [];

  const tx =
    revocations.length > 0
      ? await registry.publishRootWithRevocations(
          newRoot,
          revocations.map((r) => BigInt(r.propertyId)),
          revocations.map((r) => r.reasonCode),
          revocations.map((r) => r.detailHash),
        )
      : await registry.publishRoot(newRoot);

  const receipt = await tx.wait();

  console.log(`root      ${newRootDecimal}`);
  console.log(`bytes32   ${newRoot}`);
  console.log(`version   ${await registry.rootVersion()}`);
  if (revocations.length > 0) {
    console.log(`revoked   ${revocations.map((r) => r.propertyId).join(', ')}`);
  }
  console.log(`txHash    ${receipt?.hash ?? tx.hash}`);

  // One machine-readable line for the bench harness (Chapter 5). Every human
  // line above stays exactly as it was — this script is a tool for a person
  // first, and a subprocess second.
  //
  // `receipt` is nullable in ethers v6 (a replaced transaction yields none).
  // No receipt means no gas figure, and the harness has to be told that rather
  // than handed a zero.
  if (!receipt) throw new Error('sign:root: the transaction produced no receipt');
  console.log(
    `BENCH_RESULT ${JSON.stringify({
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
      rootVersion: Number(await registry.rootVersion()),
    })}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
