/**
 * scripts/bench/verifyOnChain.ts — ask LandRegistryVerifier itself about a proof body.
 *
 * `POST /api/proof/verify` stops at the first off-chain rule that fails, so it never shows what
 * the contract would say. This sends the body written by proof:bodies straight to the contract as
 * an eth_call and prints `valid` or the decoded custom error (D33).
 *
 *   MINE=1 pnpm --filter blockchain exec ts-node scripts/bench/verifyOnChain.ts <body.json>
 *
 * MINE=1 mines one block first (local node only), so block.timestamp is "now" and not the time
 * of the last transaction.
 */
import * as fs from 'fs';

import { ethers } from 'ethers';

import { publicSignalIndex } from '../../shared/circuitInputs';
import { loadDeployment, resolveRpcUrl } from '../../shared/deployments';
import { toSolidityCalldata } from '../../shared/solidityCalldata';
import { LandRegistryVerifier__factory } from '../../typechain-types';
import { BLOCKCHAIN_DIR } from '../lib/paths';

const NETWORK = process.env.CHAIN_NETWORK ?? 'localhost';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('usage: verifyOnChain.ts <body.json>');
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));

  const deployment = loadDeployment(BLOCKCHAIN_DIR, NETWORK);
  const provider = new ethers.JsonRpcProvider(resolveRpcUrl(NETWORK));
  if (process.env.MINE === '1') await provider.send('evm_mine', []);
  const verifier = LandRegistryVerifier__factory.connect(deployment.contracts.LandRegistryVerifier, provider);

  const { a, b, c } = toSolidityCalldata(body.proof);
  const signals = (body.publicSignals as string[]).map(BigInt);
  const block = await provider.getBlock('latest');
  const age =
    body.circuitType === 'transfer'
      ? NaN
      : block!.timestamp - Number(signals[publicSignalIndex(body.circuitType, 'currentTimestamp')]);
  try {
    if (body.circuitType === 'ownership') {
      await verifier.verifyOwnership.staticCall(a, b, c, signals as never, BigInt(body.attestation?.expiresAt ?? 0), body.attestation?.signature ?? '0x');
    } else if (body.circuitType === 'mortgage') {
      await verifier.verifyMortgage.staticCall(a, b, c, signals as never, BigInt(body.attestation?.expiresAt ?? 0), body.attestation?.signature ?? '0x');
    } else {
      await verifier.verifyTransfer.staticCall(a, b, c, signals as never);
    }
    console.log(`${body.circuitType}: valid (block ${block!.number}, timestamp ${block!.timestamp})`);
  } catch (error) {
    const data = (error as { data?: string }).data;
    const parsed = data ? verifier.interface.parseError(data) : null;
    console.log(
      `${body.circuitType}: REVERT ${parsed?.name ?? 'unknown'} ${parsed ? JSON.stringify(parsed.args.map(String)) : String(error)} ` +
        `(block ${block!.number}, timestamp ${block!.timestamp}, proof currentTimestamp ${age}s older)`,
    );
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
