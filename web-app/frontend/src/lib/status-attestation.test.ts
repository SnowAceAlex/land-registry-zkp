import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import type { ProofPackage } from '@land-registry/blockchain/shared/types';
import {
  ATTESTATION_TTL_SECONDS,
  attestationMessageFromSignals,
  statusAttestationTypedData,
} from '@land-registry/blockchain/shared/statusAttestation';

import { checkAttestation } from './status-attestation';

// Hardhat account #1 — a public test key.
const attester = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const VERIFIER = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const CHAIN_ID = 31337;
const NOW = 1_790_000_000n;
const SIGNALS = ['424242', '7', '111', NOW.toString()];

async function stapled(expiresAt: bigint, signals = SIGNALS): Promise<ProofPackage> {
  const typed = statusAttestationTypedData(
    CHAIN_ID,
    VERIFIER,
    attestationMessageFromSignals('ownership', signals, expiresAt),
  );
  const signature = await attester.signTypedData(typed as never);
  return {
    circuitType: 'ownership',
    proof: {} as never,
    publicSignals: SIGNALS,
    attestation: { expiresAt: expiresAt.toString(), signature },
  };
}

describe('checkAttestation (D82)', () => {
  it('recovers the attester from a fresh attestation', async () => {
    await expect(
      checkAttestation(await stapled(NOW + 60n), CHAIN_ID, VERIFIER, NOW),
    ).resolves.toEqual({
      ok: true,
      signer: attester.address,
    });
  });

  it('accepts the last second and calls the next one expired, like the contract', async () => {
    expect((await checkAttestation(await stapled(NOW), CHAIN_ID, VERIFIER, NOW)).ok).toBe(true);
    await expect(
      checkAttestation(await stapled(NOW - 1n), CHAIN_ID, VERIFIER, NOW),
    ).resolves.toEqual({
      ok: false,
      reason: 'AttestationExpired',
    });
  });

  it('rejects an expiry beyond the TTL', async () => {
    const tooLong = NOW + BigInt(ATTESTATION_TTL_SECONDS) + 1n;
    await expect(
      checkAttestation(await stapled(tooLong), CHAIN_ID, VERIFIER, NOW),
    ).resolves.toEqual({
      ok: false,
      reason: 'InvalidAttestation',
    });
  });

  it('recovers someone else when the note was signed for another owner', async () => {
    const other = await stapled(NOW + 60n, ['424242', '7', '999', NOW.toString()]);
    const result = await checkAttestation(other, CHAIN_ID, VERIFIER, NOW);
    expect(result.ok && result.signer).not.toBe(attester.address);
  });

  it('calls a missing attestation invalid', async () => {
    const pkg = { ...(await stapled(NOW + 60n)), attestation: undefined };
    await expect(checkAttestation(pkg, CHAIN_ID, VERIFIER, NOW)).resolves.toEqual({
      ok: false,
      reason: 'InvalidAttestation',
    });
  });
});
