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
  DeploymentRecord,
  Groth16Proof,
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

/** A RootRegistry.publishRoot rejection, decoded from its typed revert (D33). */
export class RootPublishError extends Error {
  constructor(
    readonly reason: 'DuplicateRoot' | 'ZeroRoot' | 'Unauthorized' | 'Unknown',
    message: string,
  ) {
    super(message);
    this.name = 'RootPublishError';
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
        'AUTHORITY_PRIVATE_KEY (or PRIVATE_KEY) must be set — it signs publishRoot() and ' +
          'must be an account registered via registerAuthority()',
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

  /** The address the backend signs publishRoot() with, EIP-55 checksummed. */
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

  async publishRoot(root: bigint): Promise<{ txHash: string; version: number; root: bigint }> {
    let receipt: ethers.TransactionReceipt | null;
    try {
      const tx = await this.registry.publishRoot(toBytes32(root));
      receipt = await tx.wait();
    } catch (error) {
      throw this.decodeRegistryError(error);
    }

    const version = await this.getRootVersion();
    this.logger.log(`published root version ${version} in tx ${receipt!.hash}`);
    return { txHash: receipt!.hash, version, root };
  }

  async verifyTransferOnChain(proof: Groth16Proof, publicSignals: PublicSignals): Promise<true> {
    const { a, b, c } = toSolidityCalldata(proof);
    const signals = publicSignals.map((s) => BigInt(s));
    if (signals.length !== 7) {
      throw new ProofRejectedError(
        'Unknown',
        `transfer proof must carry 7 public signals, got ${signals.length}`,
      );
    }

    try {
      await this.verifier.verifyTransfer.staticCall(
        a as [string, string],
        b as [[string, string], [string, string]],
        c as [string, string],
        signals as unknown as [bigint, bigint, bigint, bigint, bigint, bigint, bigint],
      );
      return true;
    } catch (error) {
      throw this.decodeVerifierError(error);
    }
  }

  private decodeRegistryError(error: unknown): RootPublishError {
    const data = (error as { data?: string })?.data;
    const parsed = data ? this.registry.interface.parseError(data) : null;
    const message = (error as Error)?.message ?? String(error);

    switch (parsed?.name) {
      case 'DuplicateRoot':
        return new RootPublishError(
          'DuplicateRoot',
          'This root is already the current one — there is nothing new to publish',
        );
      case 'ZeroRoot':
        return new RootPublishError(
          'ZeroRoot',
          'Refusing to publish an empty root — the registry has no issued records',
        );
      default:
        if (message.includes('AccessControlUnauthorizedAccount')) {
          return new RootPublishError(
            'Unauthorized',
            `Signer ${this.signer.address} does not hold STATE_AUTHORITY_ROLE — ` +
              'register it with registerAuthority() (see DEPLOYMENT.md)',
          );
        }
        return new RootPublishError('Unknown', `publishRoot failed: ${message}`);
    }
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
            `${await this.registry.getAddress()} — publishRoot() will revert. ` +
            `Run registerAuthority() for this account (see DEPLOYMENT.md).`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `could not check STATE_AUTHORITY_ROLE (is the node running?): ${(error as Error).message}`,
      );
    }
  }
}

/** bigint root → 32-byte hex, the form RootRegistry stores. */
export function toBytes32(root: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(root), 32);
}
