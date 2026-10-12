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
import {
  ATTESTATION_TTL_SECONDS,
  attestationMessageFromSignals,
  statusAttestationTypedData,
} from '../../shared/statusAttestation';

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

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

/** Sign a status attestation (D82) for these signals, as the backend would. */
async function attest(
  signer: Signer,
  verifierAddress: string,
  circuit: 'ownership' | 'mortgage',
  signals: bigint[],
  expiresAt: bigint,
): Promise<[bigint, string]> {
  const { chainId } = await ethers.provider.getNetwork();
  const typed = statusAttestationTypedData(
    chainId,
    verifierAddress,
    attestationMessageFromSignals(circuit, signals.map(String), expiresAt),
  );
  return [expiresAt, await signer.signTypedData(typed.domain, typed.types, typed.message)];
}

describe('contracts/LandRegistryVerifier — mock verifiers (Phase 4)', () => {
  async function deployFixture() {
    const [admin, authority, attester, stranger] = await ethers.getSigners();
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
    await registry.grantRole(await registry.ATTESTER_ROLE(), attester.address);
    const verifierAddress = await verifier.getAddress();

    /** Call the circuit's verify function, stapling a fresh attestation for ownership/mortgage. */
    async function call(circuit: CircuitType, signals: bigint[], staple?: [bigint, string]) {
      if (circuit === 'transfer') return verifier.verifyTransfer(...DUMMY_PROOF, signals);
      const now = BigInt(await time.latest());
      const args =
        staple ?? (await attest(attester, verifierAddress, circuit, signals, now + 300n));
      return circuit === 'ownership'
        ? verifier.verifyOwnership(...DUMMY_PROOF, signals, ...args)
        : verifier.verifyMortgage(...DUMMY_PROOF, signals, ...args);
    }

    return { registry, verifier, verifierAddress, mock, authority, attester, stranger, call };
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
        const { verifier, call } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        expect(await call(circuit, signalsFor(circuit, PUBLISHED_ROOT, now))).to.equal(true);
      });

      it('reverts InvalidProof when the Groth16 verifier returns false', async () => {
        const { verifier, mock, call } = await loadFixture(deployFixture);
        await mock.setResult(false);
        const now = BigInt(await time.latest());
        await expect(
          call(circuit, signalsFor(circuit, PUBLISHED_ROOT, now)),
        ).to.be.revertedWithCustomError(verifier, 'InvalidProof');
      });

      it('reverts RootMismatch when the root signal is not latestRoot', async () => {
        const { verifier, call } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        await expect(call(circuit, signalsFor(circuit, 99_999n, now)))
          .to.be.revertedWithCustomError(verifier, 'RootMismatch')
          .withArgs(asRoot(PUBLISHED_ROOT), asRoot(99_999n));
      });

      it('accepts drift of exactly ±tolerance and rejects one second beyond (D9/D26)', async () => {
        const { verifier, call } = await loadFixture(deployFixture);
        const tolerance = PROOF_TIMESTAMP_TOLERANCE_SECONDS;
        const now = BigInt(await time.latest());

        for (const boundary of [now - tolerance, now + tolerance]) {
          expect(await call(circuit, signalsFor(circuit, PUBLISHED_ROOT, boundary))).to.equal(true);
        }
        for (const beyond of [now - tolerance - 1n, now + tolerance + 1n]) {
          await expect(call(circuit, signalsFor(circuit, PUBLISHED_ROOT, beyond)))
            .to.be.revertedWithCustomError(verifier, 'StaleTimestamp')
            .withArgs(beyond, now);
        }
      });
    });
  }

  describe('status attestation (D82)', () => {
    it('mirrors ATTESTATION_TTL_SECONDS from shared/statusAttestation.ts', async () => {
      const { verifier } = await loadFixture(deployFixture);
      expect(await verifier.ATTESTATION_TTL_SECONDS()).to.equal(BigInt(ATTESTATION_TTL_SECONDS));
    });

    it('attestationDigest equals the shared EIP-712 hash (parity with ethers/viem)', async () => {
      const { verifier, verifierAddress } = await loadFixture(deployFixture);
      const { chainId } = await ethers.provider.getNetwork();
      const message = {
        propertyId: 7n,
        ownerCommitment: 11n,
        merkleRoot: 13n,
        expiresAt: 1_790_000_000n,
      };
      const typed = statusAttestationTypedData(chainId, verifierAddress, message);

      expect(
        await verifier.attestationDigest(
          message.propertyId,
          message.ownerCommitment,
          message.merkleRoot,
          message.expiresAt,
        ),
      ).to.equal(ethers.TypedDataEncoder.hash(typed.domain, typed.types, typed.message));
    });

    for (const circuit of ['ownership', 'mortgage'] as const) {
      const fn = VERIFY_FN[circuit];

      it(`${fn} accepts an attestation expiring this second, and rejects one already expired`, async () => {
        const { verifier, attester, verifierAddress, call } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        const signals = signalsFor(circuit, PUBLISHED_ROOT, now);

        expect(
          await call(
            circuit,
            signals,
            await attest(attester, verifierAddress, circuit, signals, now),
          ),
        ).to.equal(true);
        await expect(
          call(
            circuit,
            signals,
            await attest(attester, verifierAddress, circuit, signals, now - 1n),
          ),
        )
          .to.be.revertedWithCustomError(verifier, 'AttestationExpired')
          .withArgs(now - 1n, now);
      });

      it(`${fn} rejects an expiry beyond the TTL — a leaked key cannot sign long-lived notes`, async () => {
        const { verifier, attester, verifierAddress, call } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        const signals = signalsFor(circuit, PUBLISHED_ROOT, now);
        const ttl = BigInt(ATTESTATION_TTL_SECONDS);

        expect(
          await call(
            circuit,
            signals,
            await attest(attester, verifierAddress, circuit, signals, now + ttl),
          ),
        ).to.equal(true);
        await expect(
          call(
            circuit,
            signals,
            await attest(attester, verifierAddress, circuit, signals, now + ttl + 1n),
          ),
        ).to.be.revertedWithCustomError(verifier, 'InvalidAttestation');
      });

      it(`${fn} rejects a signer without ATTESTER_ROLE — a state authority included`, async () => {
        const { verifier, authority, stranger, verifierAddress, call } =
          await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        const signals = signalsFor(circuit, PUBLISHED_ROOT, now);

        for (const signer of [stranger, authority]) {
          await expect(
            call(
              circuit,
              signals,
              await attest(signer, verifierAddress, circuit, signals, now + 60n),
            ),
          ).to.be.revertedWithCustomError(verifier, 'InvalidAttestation');
        }
      });

      it(`${fn} rejects once the attester's role is revoked`, async () => {
        const { verifier, registry, attester, verifierAddress, call } =
          await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        const signals = signalsFor(circuit, PUBLISHED_ROOT, now);
        const staple = await attest(attester, verifierAddress, circuit, signals, now + 300n);

        await registry.revokeRole(await registry.ATTESTER_ROLE(), attester.address);
        await expect(call(circuit, signals, staple)).to.be.revertedWithCustomError(
          verifier,
          'InvalidAttestation',
        );
      });

      it(`${fn} rejects an attestation signed for another plot, owner or root`, async () => {
        const { verifier, attester, verifierAddress, call } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        const signals = signalsFor(circuit, PUBLISHED_ROOT, now);
        const order = PUBLIC_SIGNAL_ORDER[circuit] as readonly string[];

        for (const name of ['propertyId', 'ownerCommitment', 'merkleRoot']) {
          const other = [...signals];
          other[order.indexOf(name)] += 1n;
          const staple = await attest(attester, verifierAddress, circuit, other, now + 60n);
          await expect(call(circuit, signals, staple)).to.be.revertedWithCustomError(
            verifier,
            'InvalidAttestation',
          );
        }
      });

      it(`${fn} reports a malformed signature as InvalidAttestation, not a raw revert`, async () => {
        const { verifier, call } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        const signals = signalsFor(circuit, PUBLISHED_ROOT, now);

        for (const garbage of ['0x', '0x' + '00'.repeat(65), '0x' + 'ab'.repeat(64)]) {
          await expect(call(circuit, signals, [now + 60n, garbage])).to.be.revertedWithCustomError(
            verifier,
            'InvalidAttestation',
          );
        }
      });

      it(`${fn}: the earlier rules still win over the attestation`, async () => {
        const { verifier, mock, call } = await loadFixture(deployFixture);
        const now = BigInt(await time.latest());
        const bad: [bigint, string] = [now - 1n, '0x'];

        await expect(
          call(circuit, signalsFor(circuit, 99_999n, now), bad),
        ).to.be.revertedWithCustomError(verifier, 'RootMismatch');
        await expect(
          call(circuit, signalsFor(circuit, PUBLISHED_ROOT, now - 10_000n), bad),
        ).to.be.revertedWithCustomError(verifier, 'StaleTimestamp');
        await mock.setResult(false);
        await expect(
          call(circuit, signalsFor(circuit, PUBLISHED_ROOT, now), bad),
        ).to.be.revertedWithCustomError(verifier, 'InvalidProof');
      });
    }
  });

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
