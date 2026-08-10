/**
 * test/contracts/LandRegistryVerifier.mock.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 — dispatcher logic (root + timestamp checks, typed errors) tested
 * against MockGroth16Verifier, so it runs on a fresh checkout without
 * trusted-setup artifacts. Real-proof coverage lives in
 * LandRegistryVerifier.integration.test.ts (self-skipping).
 *
 * Public-signal arrays are built positionally from PUBLIC_SIGNAL_ORDER (D21),
 * so the Solidity index constants are exercised against the TS source of truth
 * even in these mock tests.
 */

import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { PROOF_TIMESTAMP_TOLERANCE_SECONDS } from '../../shared/datetime';

type CircuitType = keyof typeof PUBLIC_SIGNAL_ORDER;
const CIRCUITS: CircuitType[] = ['ownership', 'mortgage', 'transfer'];

const VERIFY_FN = {
  ownership: 'verifyOwnership',
  mortgage: 'verifyMortgage',
  transfer: 'verifyTransfer',
} as const;

const ROOT_SIGNAL = {
  ownership: 'merkleRoot',
  mortgage: 'merkleRoot',
  transfer: 'oldMerkleRoot',
} as const;

const PUBLISHED_ROOT = 12_345n;
const UNPUBLISHED_NEW_ROOT = 67_890n;

/** Zeroed Groth16 proof points — the mock ignores them. */
const DUMMY_PROOF = [
  [0n, 0n],
  [
    [0n, 0n],
    [0n, 0n],
  ],
  [0n, 0n],
] as const;

const asRoot = (value: bigint): string => ethers.toBeHex(value, 32);

/**
 * Build the public-signal array for a circuit from PUBLIC_SIGNAL_ORDER, filling
 * the root and currentTimestamp slots and an arbitrary constant elsewhere.
 */
function signalsFor(circuit: CircuitType, root: bigint, timestamp: bigint): bigint[] {
  return PUBLIC_SIGNAL_ORDER[circuit].map((name) => {
    if (name === ROOT_SIGNAL[circuit]) return root;
    if (name === 'currentTimestamp') return timestamp;
    if (name === 'newMerkleRoot') return UNPUBLISHED_NEW_ROOT;
    return 42n;
  });
}

describe('contracts/LandRegistryVerifier — mock verifiers (Phase 4)', () => {
  async function deployFixture() {
    const [admin, authority] = await ethers.getSigners();
    const registry = await ethers.deployContract('RootRegistry', [admin.address]);
    await registry.registerAuthority(
      authority.address,
      ethers.keccak256(ethers.toUtf8Bytes('Mock Authority')),
    );
    await registry.connect(authority).publishRoot(asRoot(PUBLISHED_ROOT));

    const mock = await ethers.deployContract('MockGroth16Verifier');
    const mockAddress = await mock.getAddress();
    const verifier = await ethers.deployContract('LandRegistryVerifier', [
      await registry.getAddress(),
      mockAddress,
      mockAddress,
      mockAddress,
    ]);
    return { registry, verifier, mock, authority };
  }

  it('rejects a zero address for any constructor dependency', async () => {
    const { registry, mock } = await loadFixture(deployFixture);
    const registryAddress = await registry.getAddress();
    const mockAddress = await mock.getAddress();
    const factory = await ethers.getContractFactory('LandRegistryVerifier');

    // All four are immutable — a zero address here can never be corrected, only
    // redeployed around, so each slot is checked independently.
    const good = [registryAddress, mockAddress, mockAddress, mockAddress];
    for (let slot = 0; slot < good.length; slot++) {
      const args = [...good];
      args[slot] = ethers.ZeroAddress;
      await expect(factory.deploy(...args)).to.be.revertedWithCustomError(
        factory,
        'ZeroAddressDependency',
      );
    }
  });

  it('mirrors PROOF_TIMESTAMP_TOLERANCE_SECONDS from shared/datetime.ts (D26)', async () => {
    const { verifier } = await loadFixture(deployFixture);
    expect(await verifier.TIMESTAMP_TOLERANCE_SECONDS()).to.equal(
      PROOF_TIMESTAMP_TOLERANCE_SECONDS,
    );
  });

  for (const circuit of CIRCUITS) {
    const fn = VERIFY_FN[circuit];

    describe(fn, () => {
      it('returns true when proof, root, and timestamp all pass', async () => {
        const { verifier } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        expect(
          await verifier[fn](...DUMMY_PROOF, signalsFor(circuit, PUBLISHED_ROOT, now)),
        ).to.equal(true);
      });

      it('reverts InvalidProof when the Groth16 verifier returns false', async () => {
        const { verifier, mock } = await loadFixture(deployFixture);
        await mock.setResult(false);
        const now = BigInt(await time.latest());
        await expect(
          verifier[fn](...DUMMY_PROOF, signalsFor(circuit, PUBLISHED_ROOT, now)),
        ).to.be.revertedWithCustomError(verifier, 'InvalidProof');
      });

      it('reverts RootMismatch when the root signal is not latestRoot', async () => {
        const { verifier } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        await expect(verifier[fn](...DUMMY_PROOF, signalsFor(circuit, 99_999n, now)))
          .to.be.revertedWithCustomError(verifier, 'RootMismatch')
          .withArgs(asRoot(PUBLISHED_ROOT), asRoot(99_999n));
      });

      it('accepts drift of exactly ±tolerance and rejects one second beyond (D9/D26)', async () => {
        const { verifier } = await loadFixture(deployFixture);
        const tolerance = PROOF_TIMESTAMP_TOLERANCE_SECONDS;
        const now = BigInt(await time.latest());

        for (const boundary of [now - tolerance, now + tolerance]) {
          expect(
            await verifier[fn](...DUMMY_PROOF, signalsFor(circuit, PUBLISHED_ROOT, boundary)),
          ).to.equal(true);
        }
        for (const beyond of [now - tolerance - 1n, now + tolerance + 1n]) {
          await expect(verifier[fn](...DUMMY_PROOF, signalsFor(circuit, PUBLISHED_ROOT, beyond)))
            .to.be.revertedWithCustomError(verifier, 'StaleTimestamp')
            .withArgs(beyond, now);
        }
      });
    });
  }

  it('verifyTransfer ignores newMerkleRoot — it need not be published yet (§3 two-step flow)', async () => {
    const { verifier, registry } = await loadFixture(deployFixture);
    const now = BigInt(await time.latest());
    const signals = signalsFor('transfer', PUBLISHED_ROOT, now);

    // Sanity: the newMerkleRoot slot really does carry an unpublished root.
    const newRootIndex = PUBLIC_SIGNAL_ORDER.transfer.indexOf('newMerkleRoot');
    expect(signals[newRootIndex]).to.equal(UNPUBLISHED_NEW_ROOT);
    expect(await registry.latestRoot()).to.not.equal(asRoot(UNPUBLISHED_NEW_ROOT));

    expect(await verifier.verifyTransfer(...DUMMY_PROOF, signals)).to.equal(true);
  });
});
