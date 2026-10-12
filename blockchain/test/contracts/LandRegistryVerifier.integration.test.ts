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
 * self-skips, same pattern as test/shared/zkpHelper.test.ts.
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
import {
  attestationMessageFromSignals,
  statusAttestationTypedData,
} from '../../shared/statusAttestation';
import { ProofPackage } from '../../shared/types';
import { generateGroth16Proof, getCircuitPaths, toSolidityCalldata } from '../../shared/zkpHelper';
import { BLOCKCHAIN_DIR } from '../../scripts/lib/paths';
import { buildSampleInput } from '../../scripts/circuits/sampleWitness';

type CircuitType = ProofPackage['circuitType'];
const CIRCUITS: CircuitType[] = ['ownership', 'mortgage', 'transfer'];

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

/** verifyOwnership/verifyMortgage/verifyTransfer differ only in tuple lengths. */
type AnyVerify = ((...args: readonly unknown[]) => Promise<boolean>) & {
  estimateGas: (...args: readonly unknown[]) => Promise<bigint>;
};

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
    const [admin, authority, attester] = await ethers.getSigners();
    const registry = await ethers.deployContract('RootRegistry', [admin.address]);
    await registry.registerAuthority(authority.address, ORG_HASH);
    await registry.grantRole(await registry.ATTESTER_ROLE(), attester.address);

    const verifierAddresses: string[] = [];
    for (const circuit of CIRCUITS) {
      const verifier = await ethers.deployContract(VERIFIER_CONTRACT[circuit]);
      verifierAddresses.push(await verifier.getAddress());
    }
    const dispatcher = await ethers.deployContract('LandRegistryVerifier', [
      await registry.getAddress(),
      ...verifierAddresses,
    ]);
    const { chainId } = await ethers.provider.getNetwork();

    /** The verify call's arguments, with a status attestation (D82) for ownership/mortgage. */
    async function verifyArgs(circuit: CircuitType, signals: string[], signer = attester) {
      const { a, b, c } = toSolidityCalldata(pkg(circuit).proof);
      if (circuit === 'transfer') return [a, b, c, signals] as const;
      const expiresAt = BigInt(await time.latest()) + 300n;
      const typed = statusAttestationTypedData(
        chainId,
        await dispatcher.getAddress(),
        attestationMessageFromSignals(circuit, signals, expiresAt),
      );
      const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
      return [a, b, c, signals, expiresAt, signature] as const;
    }

    return { registry, dispatcher, authority, verifyArgs };
  }

  const proofs = new Map<CircuitType, ProofPackage>();
  const pkg = (circuit: CircuitType): ProofPackage => proofs.get(circuit)!;

  for (const circuit of CIRCUITS) {
    const fn = VERIFY_FN[circuit];
    const order = PUBLIC_SIGNAL_ORDER[circuit] as readonly string[];
    const rootIndex = order.indexOf(ROOT_SIGNAL[circuit]);
    const timestampIndex = order.indexOf('currentTimestamp');

    describe(circuit, () => {
      before(async () => {
        // One real proof per circuit, timestamped with CHAIN time (see
        // sampleWitness) so the on-chain freshness check lines up.
        const { wasmPath, zkeyPath } = getCircuitPaths(circuit, BLOCKCHAIN_DIR);
        const chainNow = BigInt(await time.latest());
        const { input, expectedPublicSignals } = await buildSampleInput(circuit, {
          now: chainNow,
        });
        proofs.set(circuit, await generateGroth16Proof(input, wasmPath, zkeyPath, circuit));
        expect(pkg(circuit).publicSignals).to.deep.equal(expectedPublicSignals);
      });

      it('verifies a real proof against the published root, and measures gas', async () => {
        const { registry, dispatcher, authority, verifyArgs } = await deployStack();

        const publishTx = await registry
          .connect(authority)
          .publishRoot(asRoot(pkg(circuit).publicSignals[rootIndex]));
        const publishReceipt = await publishTx.wait();

        const args = await verifyArgs(circuit, pkg(circuit).publicSignals);
        expect(await (dispatcher[fn] as unknown as AnyVerify)(...args)).to.equal(true);

        gasMetrics.push({
          circuit,
          publishRootGas: publishReceipt!.gasUsed.toString(),
          verifyGas: (
            await (dispatcher[fn] as unknown as AnyVerify).estimateGas(...args)
          ).toString(),
        });
      });

      it('rejects a cryptographically tampered proof (InvalidProof)', async () => {
        const { registry, dispatcher, authority, verifyArgs } = await deployStack();
        await registry
          .connect(authority)
          .publishRoot(asRoot(pkg(circuit).publicSignals[rootIndex]));

        // Any mutated public signal breaks the pairing check before the root
        // or timestamp checks are even reached.
        const tampered = [...pkg(circuit).publicSignals];
        tampered[rootIndex === 0 ? 1 : 0] = (
          BigInt(tampered[rootIndex === 0 ? 1 : 0]) + 1n
        ).toString();
        await expect(
          (dispatcher[fn] as unknown as AnyVerify)(...(await verifyArgs(circuit, tampered))),
        ).to.be.revertedWithCustomError(dispatcher, 'InvalidProof');
      });

      it(`rejects when latestRoot moved on — error echoes publicSignals[${rootIndex}] (D21)`, async () => {
        const { registry, dispatcher, authority, verifyArgs } = await deployStack();
        await registry
          .connect(authority)
          .publishRoot(asRoot(pkg(circuit).publicSignals[rootIndex]));
        // A newer root supersedes the one the proof was built against (D29:
        // old roots survive in history but only latestRoot verifies).
        await registry.connect(authority).publishRoot(asRoot(424_242n));

        await expect(
          (dispatcher[fn] as unknown as AnyVerify)(
            ...(await verifyArgs(circuit, pkg(circuit).publicSignals)),
          ),
        )
          .to.be.revertedWithCustomError(dispatcher, 'RootMismatch')
          .withArgs(asRoot(424_242n), asRoot(pkg(circuit).publicSignals[rootIndex]));
      });

      it(`rejects a replayed proof after ±tolerance — error echoes publicSignals[${timestampIndex}] (D9/D26)`, async () => {
        const { registry, dispatcher, authority, verifyArgs } = await deployStack();
        await registry
          .connect(authority)
          .publishRoot(asRoot(pkg(circuit).publicSignals[rootIndex]));

        // Snapshot so the time jump doesn't leak into later tests, which use
        // proofs timestamped before it.
        const snapshot = await takeSnapshot();
        try {
          await time.increase(PROOF_TIMESTAMP_TOLERANCE_SECONDS + 100n);
          const args = await verifyArgs(circuit, pkg(circuit).publicSignals);
          await expect((dispatcher[fn] as unknown as AnyVerify)(...args))
            .to.be.revertedWithCustomError(dispatcher, 'StaleTimestamp')
            .withArgs(BigInt(pkg(circuit).publicSignals[timestampIndex]), await time.latest());
        } finally {
          await snapshot.restore();
        }
      });

      if (circuit !== 'transfer') {
        it('rejects a real proof attested by a non-attester, accepts the attester (D82)', async () => {
          const { registry, dispatcher, authority, verifyArgs } = await deployStack();
          await registry
            .connect(authority)
            .publishRoot(asRoot(pkg(circuit).publicSignals[rootIndex]));

          // A state authority can publish roots but cannot vouch for status.
          const byAuthority = await verifyArgs(circuit, pkg(circuit).publicSignals, authority);
          await expect(
            (dispatcher[fn] as unknown as AnyVerify)(...byAuthority),
          ).to.be.revertedWithCustomError(dispatcher, 'InvalidAttestation');

          const byAttester = await verifyArgs(circuit, pkg(circuit).publicSignals);
          expect(await (dispatcher[fn] as unknown as AnyVerify)(...byAttester)).to.equal(true);
        });
      }

      if (circuit === 'transfer') {
        it('two-step flow (§3): verify BEFORE publishRoot(newRoot); afterwards the proof is spent', async () => {
          const { registry, dispatcher, authority, verifyArgs } = await deployStack();
          const { a, b, c } = toSolidityCalldata(pkg(circuit).proof);
          const oldRoot = asRoot(pkg(circuit).publicSignals[0]);
          const newRootIndex = PUBLIC_SIGNAL_ORDER.transfer.indexOf('newMerkleRoot');
          const newRoot = asRoot(pkg(circuit).publicSignals[newRootIndex]);

          // Step 1: state authority confirms the transfer against the CURRENT
          // root — newRoot is not published yet.
          await registry.connect(authority).publishRoot(oldRoot);
          expect(await dispatcher.verifyTransfer(a, b, c, pkg(circuit).publicSignals)).to.equal(
            true,
          );

          // Step 2: authority publishes the new root. The same proof now fails
          // — its oldMerkleRoot has stopped being latest.
          await registry.connect(authority).publishRoot(newRoot);
          await expect(dispatcher.verifyTransfer(a, b, c, pkg(circuit).publicSignals))
            .to.be.revertedWithCustomError(dispatcher, 'RootMismatch')
            .withArgs(newRoot, oldRoot);
        });
      }
    });
  }
});
