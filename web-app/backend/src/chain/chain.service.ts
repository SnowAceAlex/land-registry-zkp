import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import {
  LandRegistryVerifier,
  LandRegistryVerifier__factory,
  RootRegistry,
  RootRegistry__factory,
} from '@land-registry/blockchain/typechain-types';
import {
  ChainNetwork,
  CircuitType,
  DeploymentRecord,
  Groth16Proof,
  PUBLIC_SIGNAL_ORDER,
  PublicSignals,
  loadDeployment,
  resolveRpcUrl,
  toSolidityCalldata,
} from '@land-registry/blockchain/shared';

import { blockchainDir } from '../common/paths';

/**
 * ChainService
 * ─────────────────────────────────────────────────────────────────────────────
 * The backend's only door to Ethereum. Contract bindings come from the
 * generated typechain-types (regenerate with `pnpm run compile`) — no
 * hand-written ABIs, which would drift from the deployed contracts.
 *
 * Addresses are read from blockchain/deployments/<network>.json, the file
 * scripts/deploy.ts writes, so the backend always talks to the deployment that
 * was actually made rather than to addresses copied into env by hand.
 */

// ChainNetwork and DeploymentRecord now come from the shared package, next to
// the loader — three copies of that record had already drifted apart. Still
// re-exported here so callers importing them from ChainService keep working.
export type { ChainNetwork, DeploymentRecord };

/** A LandRegistryVerifier rejection, decoded from its typed revert (D33). */
export class ProofRejectedError extends Error {
  constructor(
    readonly reason: 'InvalidProof' | 'RootMismatch' | 'StaleTimestamp' | 'Unknown',
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ProofRejectedError';
  }
}

@Injectable()
export class ChainService implements OnModuleInit {
  private readonly logger = new Logger(ChainService.name);

  private provider!: ethers.JsonRpcProvider;
  private signer!: ethers.Wallet;
  private registry!: RootRegistry;
  private verifier!: LandRegistryVerifier;
  private deployment!: DeploymentRecord;

  async onModuleInit(): Promise<void> {
    const network = (process.env.CHAIN_NETWORK ?? 'localhost') as ChainNetwork;
    this.deployment = loadDeployment(blockchainDir(), network);

    const rpcUrl = resolveRpcUrl(network);
    const privateKey = process.env.AUTHORITY_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error(
        'AUTHORITY_PRIVATE_KEY (or PRIVATE_KEY) must be set — it is used for read calls ' +
          'against RootRegistry/LandRegistryVerifier and should be the account registered ' +
          'via registerAuthority() (on-chain writes are signed in the browser, D43)',
      );
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    this.registry = RootRegistry__factory.connect(
      process.env.ROOT_REGISTRY_ADDRESS ?? this.deployment.contracts.RootRegistry,
      this.signer,
    );
    this.verifier = LandRegistryVerifier__factory.connect(
      process.env.LAND_REGISTRY_VERIFIER_ADDRESS ?? this.deployment.contracts.LandRegistryVerifier,
      this.signer,
    );

    this.logger.log(
      `connected to ${network} (${rpcUrl}) as ${this.signer.address}; ` +
        `RootRegistry=${await this.registry.getAddress()}`,
    );

    await this.warnIfNotAuthority();
  }

  /**
   * The signer's address, EIP-55 checksummed. Used for read calls only — the
   * backend no longer sends any transaction; on-chain writes are signed in
   * the officer's browser wallet (D43).
   */
  get authorityAddress(): string {
    return ethers.getAddress(this.signer.address);
  }

  get rootRegistryAddress(): string {
    return process.env.ROOT_REGISTRY_ADDRESS ?? this.deployment.contracts.RootRegistry;
  }

  get network(): ChainNetwork {
    return (process.env.CHAIN_NETWORK ?? 'localhost') as ChainNetwork;
  }

  /** keccak256 of the X.509 organization name anchored on-chain for an authority (D30). */
  async getAuthorityInstitute(account: string): Promise<string> {
    return this.registry.authorityInstitute(account);
  }

  async hasAuthorityRole(account: string): Promise<boolean> {
    const role = await this.registry.STATE_AUTHORITY_ROLE();
    return this.registry.hasRole(role, account);
  }

  /** Current effective root, as the bigint the Merkle layer speaks in. */
  async getLatestRoot(): Promise<bigint> {
    return BigInt(await this.registry.latestRoot());
  }

  async getRootVersion(): Promise<number> {
    return Number(await this.registry.rootVersion());
  }

  /**
   * Verify a proof through LandRegistryVerifier, which also re-checks the root
   * against `latestRoot` and the timestamp against `block.timestamp` (D9/D26).
   *
   * `staticCall` because the verifier functions are `view`: this is a question
   * asked of the chain, not a state change, and it costs no gas. The contract
   * signals rejection by reverting with a typed error (D33) rather than
   * returning false, so a thrown {@link ProofRejectedError} — not a `false`
   * return — is the "invalid" answer.
   */
  async verifyOnChain(
    circuitType: CircuitType,
    proof: Groth16Proof,
    publicSignals: PublicSignals,
  ): Promise<true> {
    const expected = PUBLIC_SIGNAL_ORDER[circuitType].length;
    if (publicSignals.length !== expected) {
      throw new ProofRejectedError(
        'Unknown',
        `a ${circuitType} proof carries ${expected} public signals (D21), ` +
          `got ${publicSignals.length}`,
      );
    }

    const { a, b, c } = toSolidityCalldata(proof);
    const signals = publicSignals.map((s) => BigInt(s));

    // The three overloads differ only in the fixed-length pubSignals tuple
    // (uint[4]/[5]/[7]); the length is already checked above, so the casts
    // restate what PUBLIC_SIGNAL_ORDER has established rather than assume it.
    const args = [
      a as [string, string],
      b as [[string, string], [string, string]],
      c as [string, string],
    ] as const;

    try {
      switch (circuitType) {
        case 'ownership':
          await this.verifier.verifyOwnership.staticCall(
            ...args,
            signals as unknown as [bigint, bigint, bigint, bigint],
          );
          break;
        case 'mortgage':
          await this.verifier.verifyMortgage.staticCall(
            ...args,
            signals as unknown as [bigint, bigint, bigint, bigint, bigint],
          );
          break;
        case 'transfer':
          await this.verifier.verifyTransfer.staticCall(
            ...args,
            signals as unknown as [bigint, bigint, bigint, bigint, bigint, bigint, bigint],
          );
          break;
      }
      return true;
    } catch (error) {
      throw this.decodeVerifierError(error);
    }
  }

  /** {@link verifyOnChain} for the transfer flow (D28 step 4). */
  async verifyTransferOnChain(proof: Groth16Proof, publicSignals: PublicSignals): Promise<true> {
    return this.verifyOnChain('transfer', proof, publicSignals);
  }

  private decodeVerifierError(error: unknown): ProofRejectedError {
    const data = (error as { data?: string })?.data;
    const parsed = data ? this.verifier.interface.parseError(data) : null;

    switch (parsed?.name) {
      case 'InvalidProof':
        return new ProofRejectedError(
          'InvalidProof',
          'The Groth16 proof is not valid for this circuit',
        );
      case 'RootMismatch': {
        const [expected, actual] = parsed.args as unknown as [string, string];
        return new ProofRejectedError(
          'RootMismatch',
          'The proof was generated against a root that is no longer current — ' +
            'the registry moved on, so the transfer must be re-proven',
          { expected, actual },
        );
      }
      case 'StaleTimestamp': {
        const [claimed, blockTime] = parsed.args as unknown as [bigint, bigint];
        return new ProofRejectedError(
          'StaleTimestamp',
          'The proof timestamp is outside the ±10 minute tolerance of chain time',
          { claimed: claimed.toString(), blockTime: blockTime.toString() },
        );
      }
      default:
        return new ProofRejectedError(
          'Unknown',
          `On-chain verification failed: ${(error as Error)?.message ?? String(error)}`,
        );
    }
  }

  private async warnIfNotAuthority(): Promise<void> {
    try {
      if (!(await this.hasAuthorityRole(this.signer.address))) {
        this.logger.error(
          `signer ${this.signer.address} does NOT hold STATE_AUTHORITY_ROLE on ` +
            `${await this.registry.getAddress()} — any on-chain write signed with this role ` +
            `will be rejected. Run registerAuthority() for this account (see DEPLOYMENT.md).`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `could not check STATE_AUTHORITY_ROLE (is the node running?): ${(error as Error).message}`,
      );
    }
  }
}
