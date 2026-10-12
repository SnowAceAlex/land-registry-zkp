import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import {
  ATTESTATION_TTL_SECONDS,
  AttestationStaple,
  attestationMessageFromSignals,
  nowUnixTimestamp,
  statusAttestationTypedData,
} from '@land-registry/blockchain/shared';

import { ChainService, ProofRejectedError } from '../chain/chain.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttestationResponseDto } from './dto/attestation.response.dto';
import { requireIssuedProperty } from './issued-property';

/** Hardhat account #1 — a public test key, so only ever the local default. */
const LOCAL_DEFAULT_ATTESTER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const DECIMAL = /^\d+$/;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

/**
 * AttestationService — the backend's signed "no open procedure" note (D82).
 *
 * Signs only public data (propertyId, the DB commitment, the chain root), so the
 * route is unguarded like the rest of /api/proof (D39). It sends no transaction (D43).
 */
@Injectable()
export class AttestationService implements OnModuleInit {
  private readonly logger = new Logger(AttestationService.name);
  private wallet!: ethers.Wallet;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  async onModuleInit(): Promise<void> {
    const network = process.env.CHAIN_NETWORK ?? 'localhost';
    const key =
      process.env.ATTESTER_PRIVATE_KEY?.trim() ||
      (['localhost', 'hardhat'].includes(network) ? LOCAL_DEFAULT_ATTESTER_KEY : '');
    if (!key) {
      throw new Error(
        `ATTESTER_PRIVATE_KEY must be set on ${network} — the account granted ATTESTER_ROLE ` +
          'at deploy (ATTESTER_ADDRESS, D82)',
      );
    }
    this.useKey(key);

    try {
      if (!(await this.chain.hasAttesterRole(this.wallet.address))) {
        this.logger.error(
          `attester ${this.wallet.address} does NOT hold ATTESTER_ROLE — every ownership/` +
            'mortgage proof will be rejected with InvalidAttestation. Redeploy, or grantRole it (D82).',
        );
      }
    } catch (error) {
      this.logger.warn(`could not check ATTESTER_ROLE: ${(error as Error).message}`);
    }
  }

  /** Separate from onModuleInit so a unit test can sign without a chain. */
  useKey(privateKey: string): void {
    this.wallet = new ethers.Wallet(privateKey);
  }

  /** Sign the plot's current status, or 409 while it has an open procedure. */
  async sign(propertyId: string, now = nowUnixTimestamp()): Promise<AttestationResponseDto> {
    const property = await requireIssuedProperty(this.prisma, propertyId);
    await this.assertNoOpenProcedure(propertyId);

    const merkleRoot = await this.chain.getLatestRoot();
    const expiresAt = now + BigInt(ATTESTATION_TTL_SECONDS);
    const verifyingContract = this.chain.landRegistryVerifierAddress;
    const typed = statusAttestationTypedData(this.chain.chainId, verifyingContract, {
      propertyId: BigInt(propertyId),
      ownerCommitment: BigInt(property.ownerCommitment!),
      merkleRoot,
      expiresAt,
    });

    return {
      propertyId,
      ownerCommitment: property.ownerCommitment!,
      merkleRoot: merkleRoot.toString(),
      expiresAt: expiresAt.toString(),
      signature: await this.wallet.signTypedData(typed.domain, typed.types, typed.message),
      attester: this.wallet.address,
      chainId: this.chain.chainId,
      verifyingContract,
    };
  }

  /**
   * The off-chain twin of LandRegistryVerifier._requireAttested: expired →
   * AttestationExpired; anything else wrong → InvalidAttestation.
   */
  async verifyStaple(
    circuitType: 'ownership' | 'mortgage',
    publicSignals: readonly string[],
    staple: AttestationStaple | undefined,
    now = nowUnixTimestamp(),
  ): Promise<void> {
    if (!staple || !DECIMAL.test(staple.expiresAt) || !SIGNATURE.test(staple.signature)) {
      throw invalid(`A ${circuitType} proof must carry a well-formed status attestation (D82)`);
    }

    const expiresAt = BigInt(staple.expiresAt);
    if (now > expiresAt) {
      throw new ProofRejectedError(
        'AttestationExpired',
        'The status attestation has expired — fetch a new one and re-prove (D82)',
        { expiresAt: staple.expiresAt, now: now.toString() },
      );
    }
    if (expiresAt > now + BigInt(ATTESTATION_TTL_SECONDS)) {
      throw invalid('The status attestation claims a longer validity than any attester may sign');
    }

    const typed = statusAttestationTypedData(
      this.chain.chainId,
      this.chain.landRegistryVerifierAddress,
      attestationMessageFromSignals(circuitType, publicSignals, expiresAt),
    );
    let signer: string;
    try {
      signer = ethers.verifyTypedData(typed.domain, typed.types, typed.message, staple.signature);
    } catch {
      throw invalid('The status attestation signature cannot be recovered');
    }
    if (!(await this.chain.hasAttesterRole(signer))) {
      throw invalid('The status attestation was not signed by an attester for this proof');
    }
  }

  private async assertNoOpenProcedure(propertyId: string): Promise<void> {
    const [transfer, revocation] = await Promise.all([
      this.prisma.transferRequest.findFirst({
        where: { propertyId, status: { in: ['PENDING', 'APPROVED'] } },
        select: { id: true },
      }),
      this.prisma.revocation.findFirst({
        where: { propertyId, status: 'PENDING' },
        select: { id: true },
      }),
    ]);
    if (!transfer && !revocation) return;

    throw new ConflictException({
      reason: 'ProcedureOpen',
      message:
        `Property ${propertyId} has an open ${transfer ? 'transfer' : 'revocation'} — its ` +
        'current owner cannot back a proof until the registry publishes or closes it (D82)',
      details: { propertyId, kind: transfer ? 'transfer' : 'revocation' },
    });
  }
}

function invalid(message: string): ProofRejectedError {
  return new ProofRejectedError('InvalidAttestation', message);
}
