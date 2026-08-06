/**
 * test/contracts/LandRegistryVerifier.integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 — end-to-end on-chain verification with REAL proofs: witness built by
 * sampleWitness, proven through shared/zkpHelper, verified by the actual
 * generated Groth16 verifiers behind LandRegistryVerifier.
 *
 * Needs the gitignored trusted-setup artifacts (wasm/zkey) AND the synced
 * verifier contracts (contracts/verifiers/*.sol — produced by circuits:setup,
 * compiled by Hardhat before tests run). On a checkout without them this suite
 * self-skips, same pattern as test/zkpHelper.test.ts.
 *
 * D21 cross-check: the reject-path assertions read the root/timestamp positions
 * from PUBLIC_SIGNAL_ORDER (TS source of truth) and require the contract's
 * typed-error arguments to echo exactly those elements — if the Solidity index
 * constants ever drift from the TS order, these tests break.
 *
 * Gas numbers for Chapter 5 are collected along the way and written to
 * circuits/build/gas-metrics.json (gitignored, reproducible).
 */

import { takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'hardhat';

import { PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { PROOF_TIMESTAMP_TOLERANCE_SECONDS } from '../../shared/datetime';
import { ProofPackage } from '../../shared/types';
import { generateGroth16Proof, getCircuitPaths, toSolidityCalldata } from '../../shared/zkpHelper';
import { buildSampleInput } from '../../scripts/setup/sampleWitness';

type CircuitType = ProofPackage['circuitType'];
const CIRCUITS: CircuitType[] = ['ownership', 'mortgage', 'transfer'];

const BLOCKCHAIN_DIR = path.resolve(__dirname, '../..');

const VERIFY_FN = {
  ownership: 'verifyOwnership',
  mortgage: 'verifyMortgage',
  transfer: 'verifyTransfer',
} as const;

const VERIFIER_CONTRACT = {
  ownership: 'Groth16VerifierOwnership',
  mortgage: 'Groth16VerifierMortgage',
  transfer: 'Groth16VerifierTransfer',
} as const;

const ROOT_SIGNAL = {
  ownership: 'merkleRoot',
  mortgage: 'merkleRoot',
  transfer: 'oldMerkleRoot',
} as const;

const ORG_HASH = ethers.keccak256(ethers.toUtf8Bytes('Integration Test Authority'));

const asRoot = (value: string | bigint): string => ethers.toBeHex(BigInt(value), 32);

/** True when every trusted-setup artifact + synced verifier this suite needs exists. */
const artifactsAvailable = CIRCUITS.every((circuit) => {
  const { wasmPath, zkeyPath } = getCircuitPaths(circuit, BLOCKCHAIN_DIR);
  const verifierSol = path.join(
    BLOCKCHAIN_DIR,
    'contracts',
    'verifiers',
    `${VERIFIER_CONTRACT[circuit]}.sol`,
  );
  return [wasmPath, zkeyPath, verifierSol].every((p) => fs.existsSync(p));
});

interface GasMetric {
  circuit: CircuitType;
  publishRootGas: string;
  verifyGas: string;
}
const gasMetrics: GasMetric[] = [];

describe('contracts/LandRegistryVerifier — real proofs (integration, Phase 4)', function () {
  before(function () {
    if (!artifactsAvailable) {
      console.log(
        '      (skipped: run `pnpm --filter blockchain run circuits:setup` + `pnpm run compile` first)',
      );
      this.skip();
    }
  });

  after(() => {
    if (gasMetrics.length === 0) return;
    const metricsPath = path.join(BLOCKCHAIN_DIR, 'circuits', 'build', 'gas-metrics.json');
    fs.writeFileSync(
      metricsPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), metrics: gasMetrics }, null, 2),
    );
    console.log(`\n      gas metrics → ${path.relative(BLOCKCHAIN_DIR, metricsPath)}`);
    console.table(gasMetrics);
  });

  /** Deploy registry + the three REAL generated verifiers + the dispatcher. */
  async function deployStack() {
    const [admin, authority] = await ethers.getSigners();
    const registry = await ethers.deployContract('RootRegistry', [admin.address]);
    await registry.registerAuthority(authority.address, ORG_HASH);

    const verifierAddresses: string[] = [];
    for (const circuit of CIRCUITS) {
      const verifier = await ethers.deployContract(VERIFIER_CONTRACT[circuit]);
      verifierAddresses.push(await verifier.getAddress());
    }
    const dispatcher = await ethers.deployContract('LandRegistryVerifier', [
      await registry.getAddress(),
      ...verifierAddresses,
    ]);
    return { registry, dispatcher, authority };
  }

  for (const circuit of CIRCUITS) {
    const fn = VERIFY_FN[circuit];
    const order = PUBLIC_SIGNAL_ORDER[circuit] as readonly string[];
    const rootIndex = order.indexOf(ROOT_SIGNAL[circuit]);
    const timestampIndex = order.indexOf('currentTimestamp');

    describe(circuit, () => {
      let pkg: ProofPackage;

      before(async () => {
        // One real proof per circuit, timestamped with CHAIN time (see
        // sampleWitness) so the on-chain freshness check lines up.
        const { wasmPath, zkeyPath } = getCircuitPaths(circuit, BLOCKCHAIN_DIR);
        const chainNow = BigInt(await time.latest());
        const { input, expectedPublicSignals } = await buildSampleInput(circuit, {
          now: chainNow,
        });
        pkg = await generateGroth16Proof(input, wasmPath, zkeyPath, circuit);
        expect(pkg.publicSignals).to.deep.equal(expectedPublicSignals);
      });

      it('verifies a real proof against the published root, and measures gas', async () => {
        const { registry, dispatcher, authority } = await deployStack();
        const { a, b, c } = toSolidityCalldata(pkg.proof);

        const publishTx = await registry
          .connect(authority)
          .publishRoot(asRoot(pkg.publicSignals[rootIndex]));
        const publishReceipt = await publishTx.wait();

        expect(await dispatcher[fn](a, b, c, pkg.publicSignals)).to.equal(true);

        gasMetrics.push({
          circuit,
          publishRootGas: publishReceipt!.gasUsed.toString(),
          verifyGas: (await dispatcher[fn].estimateGas(a, b, c, pkg.publicSignals)).toString(),
        });
      });

      it('rejects a cryptographically tampered proof (InvalidProof)', async () => {
        const { registry, dispatcher, authority } = await deployStack();
        const { a, b, c } = toSolidityCalldata(pkg.proof);
        await registry.connect(authority).publishRoot(asRoot(pkg.publicSignals[rootIndex]));

        // Any mutated public signal breaks the pairing check before the root
        // or timestamp checks are even reached.
        const tampered = [...pkg.publicSignals];
        tampered[rootIndex === 0 ? 1 : 0] = (
          BigInt(tampered[rootIndex === 0 ? 1 : 0]) + 1n
        ).toString();
        await expect(dispatcher[fn](a, b, c, tampered)).to.be.revertedWithCustomError(
          dispatcher,
          'InvalidProof',
        );
      });

      it(`rejects when latestRoot moved on — error echoes publicSignals[${rootIndex}] (D21)`, async () => {
        const { registry, dispatcher, authority } = await deployStack();
        const { a, b, c } = toSolidityCalldata(pkg.proof);
        await registry.connect(authority).publishRoot(asRoot(pkg.publicSignals[rootIndex]));
        // A newer root supersedes the one the proof was built against (D29:
        // old roots survive in history but only latestRoot verifies).
        await registry.connect(authority).publishRoot(asRoot(424_242n));

        await expect(dispatcher[fn](a, b, c, pkg.publicSignals))
          .to.be.revertedWithCustomError(dispatcher, 'RootMismatch')
          .withArgs(asRoot(424_242n), asRoot(pkg.publicSignals[rootIndex]));
      });

      it(`rejects a replayed proof after ±tolerance — error echoes publicSignals[${timestampIndex}] (D9/D26)`, async () => {
        const { registry, dispatcher, authority } = await deployStack();
        const { a, b, c } = toSolidityCalldata(pkg.proof);
        await registry.connect(authority).publishRoot(asRoot(pkg.publicSignals[rootIndex]));

        // Snapshot so the time jump doesn't leak into later tests, which use
        // proofs timestamped before it.
        const snapshot = await takeSnapshot();
        try {
          await time.increase(PROOF_TIMESTAMP_TOLERANCE_SECONDS + 100n);
          await expect(dispatcher[fn](a, b, c, pkg.publicSignals))
            .to.be.revertedWithCustomError(dispatcher, 'StaleTimestamp')
            .withArgs(BigInt(pkg.publicSignals[timestampIndex]), await time.latest());
        } finally {
          await snapshot.restore();
        }
      });

      if (circuit === 'transfer') {
        it('two-step flow (§3): verify BEFORE publishRoot(newRoot); afterwards the proof is spent', async () => {
          const { registry, dispatcher, authority } = await deployStack();
          const { a, b, c } = toSolidityCalldata(pkg.proof);
          const oldRoot = asRoot(pkg.publicSignals[0]);
          const newRootIndex = PUBLIC_SIGNAL_ORDER.transfer.indexOf('newMerkleRoot');
          const newRoot = asRoot(pkg.publicSignals[newRootIndex]);

          // Step 1: state authority confirms the transfer against the CURRENT
          // root — newRoot is not published yet.
          await registry.connect(authority).publishRoot(oldRoot);
          expect(await dispatcher.verifyTransfer(a, b, c, pkg.publicSignals)).to.equal(true);

          // Step 2: authority publishes the new root. The same proof now fails
          // — its oldMerkleRoot has stopped being latest.
          await registry.connect(authority).publishRoot(newRoot);
          await expect(dispatcher.verifyTransfer(a, b, c, pkg.publicSignals))
            .to.be.revertedWithCustomError(dispatcher, 'RootMismatch')
            .withArgs(newRoot, oldRoot);
        });
      }
    });
  }
});
