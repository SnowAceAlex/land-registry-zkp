import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { ethers } from 'ethers';
import {
  ATTESTATION_TTL_SECONDS,
  attestationMessageFromSignals,
  statusAttestationTypedData,
} from '@land-registry/blockchain/shared';

import { ChainService } from '../chain/chain.service';
import { PrismaService } from '../prisma/prisma.service';
import { makeProperty } from '../../test/factories';
import { AttestationService } from './attestation.service';

// Hardhat account #1 — a public test key.
const ATTESTER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const VERIFIER = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const CHAIN_ID = 31337;
const ROOT = 424242n;
const NOW = 1_790_000_000n;

function setup(overrides: { transfer?: object | null; revocation?: object | null } = {}) {
  const property = makeProperty({ propertyId: '7' });
  const prisma = {
    property: { findUnique: jest.fn().mockResolvedValue(property) },
    transferRequest: { findFirst: jest.fn().mockResolvedValue(overrides.transfer ?? null) },
    revocation: { findFirst: jest.fn().mockResolvedValue(overrides.revocation ?? null) },
  };
  const chain = {
    chainId: CHAIN_ID,
    landRegistryVerifierAddress: VERIFIER,
    getLatestRoot: jest.fn().mockResolvedValue(ROOT),
    hasAttesterRole: jest.fn().mockResolvedValue(true),
  };
  const service = new AttestationService(
    prisma as unknown as PrismaService,
    chain as unknown as ChainService,
  );
  service.useKey(ATTESTER_KEY);
  return { service, prisma, chain, property };
}

/** Ownership signals for the factory's plot 7, against ROOT. */
function signalsFor(property: ReturnType<typeof makeProperty>): string[] {
  return [ROOT.toString(), property.propertyId, property.ownerCommitment!, NOW.toString()];
}

describe('AttestationService.sign (D82)', () => {
  it('signs the chain root and the stored commitment, recoverable to the attester', async () => {
    const { service, property } = setup();

    const response = await service.sign('7', NOW);

    expect(response).toMatchObject({
      propertyId: '7',
      ownerCommitment: property.ownerCommitment,
      merkleRoot: ROOT.toString(),
      expiresAt: (NOW + BigInt(ATTESTATION_TTL_SECONDS)).toString(),
      chainId: CHAIN_ID,
      verifyingContract: VERIFIER,
      attester: new ethers.Wallet(ATTESTER_KEY).address,
    });
    const typed = statusAttestationTypedData(
      CHAIN_ID,
      VERIFIER,
      attestationMessageFromSignals('ownership', signalsFor(property), response.expiresAt),
    );
    expect(
      ethers.verifyTypedData(typed.domain, typed.types, typed.message, response.signature),
    ).toBe(response.attester);
  });

  it('refuses with 409 ProcedureOpen while a transfer is open', async () => {
    const { service } = setup({ transfer: { id: 3, status: 'APPROVED' } });

    const error = await service.sign('7', NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      reason: 'ProcedureOpen',
      details: { propertyId: '7', kind: 'transfer' },
    });
  });

  it('refuses with 409 ProcedureOpen while a revocation is pending', async () => {
    const { service } = setup({ revocation: { id: 4 } });

    const error = await service.sign('7', NOW).catch((e: unknown) => e);
    expect((error as ConflictException).getResponse()).toMatchObject({
      reason: 'ProcedureOpen',
      details: { kind: 'revocation' },
    });
  });

  it('answers 404 / 400 / 410 like GET /api/proof/:id', async () => {
    const { service, prisma } = setup();

    prisma.property.findUnique.mockResolvedValueOnce(null);
    await expect(service.sign('7', NOW)).rejects.toBeInstanceOf(NotFoundException);

    prisma.property.findUnique.mockResolvedValueOnce(
      makeProperty({ ownerCommitment: null, status: 'IMPORTED' }),
    );
    await expect(service.sign('7', NOW)).rejects.toBeInstanceOf(BadRequestException);

    prisma.property.findUnique.mockResolvedValueOnce(makeProperty({ status: 'REVOKED' }));
    await expect(service.sign('7', NOW)).rejects.toBeInstanceOf(GoneException);
  });
});

describe('AttestationService.verifyStaple (D82)', () => {
  async function stapleFor(signals: string[], expiresAt: bigint, key = ATTESTER_KEY) {
    const typed = statusAttestationTypedData(
      CHAIN_ID,
      VERIFIER,
      attestationMessageFromSignals('ownership', signals, expiresAt),
    );
    const signature = await new ethers.Wallet(key).signTypedData(
      typed.domain,
      typed.types,
      typed.message,
    );
    return { expiresAt: expiresAt.toString(), signature };
  }

  it('accepts a fresh attestation from an attester', async () => {
    const { service, property } = setup();
    const signals = signalsFor(property);

    await expect(
      service.verifyStaple('ownership', signals, await stapleFor(signals, NOW + 60n), NOW),
    ).resolves.toBeUndefined();
  });

  it('rejects a missing or malformed attestation as InvalidAttestation', async () => {
    const { service, property } = setup();
    const signals = signalsFor(property);

    for (const staple of [
      undefined,
      { expiresAt: 'soon', signature: '0x00' },
      { expiresAt: (NOW + 60n).toString(), signature: '0x1234' },
    ]) {
      await expect(service.verifyStaple('ownership', signals, staple, NOW)).rejects.toMatchObject({
        reason: 'InvalidAttestation',
      });
    }
  });

  it('rejects an expired one as AttestationExpired, and accepts the last second', async () => {
    const { service, property } = setup();
    const signals = signalsFor(property);

    await expect(
      service.verifyStaple('ownership', signals, await stapleFor(signals, NOW), NOW),
    ).resolves.toBeUndefined();
    await expect(
      service.verifyStaple('ownership', signals, await stapleFor(signals, NOW - 1n), NOW),
    ).rejects.toMatchObject({ reason: 'AttestationExpired' });
  });

  it('rejects an expiry beyond the TTL, like the contract', async () => {
    const { service, property } = setup();
    const signals = signalsFor(property);
    const tooLong = NOW + BigInt(ATTESTATION_TTL_SECONDS) + 1n;

    await expect(
      service.verifyStaple('ownership', signals, await stapleFor(signals, tooLong), NOW),
    ).rejects.toMatchObject({ reason: 'InvalidAttestation' });
  });

  it('rejects a signer the chain does not list as an attester', async () => {
    const { service, property, chain } = setup();
    const signals = signalsFor(property);
    const stranger = ethers.Wallet.createRandom().privateKey;
    chain.hasAttesterRole.mockResolvedValueOnce(false);

    await expect(
      service.verifyStaple(
        'ownership',
        signals,
        await stapleFor(signals, NOW + 60n, stranger),
        NOW,
      ),
    ).rejects.toMatchObject({ reason: 'InvalidAttestation' });
  });

  it('rejects an attestation for another owner of the same plot', async () => {
    const { service, property, chain } = setup();
    const signals = signalsFor(property);
    const other = [...signals];
    other[2] = '999';
    // A signature over different data recovers to some other address.
    chain.hasAttesterRole.mockImplementation(
      async (account: string) => account === new ethers.Wallet(ATTESTER_KEY).address,
    );

    await expect(
      service.verifyStaple('ownership', signals, await stapleFor(other, NOW + 60n), NOW),
    ).rejects.toMatchObject({ reason: 'InvalidAttestation' });
  });
});
