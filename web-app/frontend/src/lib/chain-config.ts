/**
 * lib/chain-config.ts - which chain to read, and how to reach it.
 *
 * The resident portal is logged-out (D39/D49), so it cannot call the guarded
 * `GET /api/government/status`. It reads `GET /api/public/config` instead (D58),
 * which serves the network, the chain id and the two contract addresses.
 *
 * ⚠️ THE RPC URL IS NOT SERVED, AND MUST NOT BE. `resolveRpcUrl()` on the
 *    backend may carry a provider key, and a JSON response handed to a
 *    logged-out page is a published document. The transport is therefore chosen
 *    HERE, from the chain id alone — mirroring the two-chain list in
 *    features/government/wallet/wallet-config.ts so the two portals cannot
 *    drift onto different endpoints.
 *
 * Reads only. There is no wallet and no connector on a resident page: verifying
 * on chain is an `eth_call`, which costs nothing and signs nothing (D61).
 */

import {
  type Address,
  type Chain,
  type PublicClient,
  createPublicClient,
  http,
} from 'viem';
import { hardhat, sepolia } from 'viem/chains';

import { apiFetch } from './api-client';

export interface PublicChainConfig {
  network: string;
  chainId: number;
  contracts: {
    RootRegistry: Address;
    LandRegistryVerifier: Address;
  };
}

/** GET /api/public/config (D58). Unguarded — no key is attached or needed. */
export async function fetchPublicChainConfig(): Promise<PublicChainConfig> {
  return apiFetch<PublicChainConfig>('/public/config');
}

/**
 * A browser-reachable RPC endpoint for a chain id.
 *
 * Deliberately NOT read from the API response: see the file header. A chain
 * this build has no endpoint for throws rather than silently falling back,
 * because the failure a verifier must never see is a check quietly reported
 * against the wrong chain.
 */
export function rpcUrlForChain(chainId: number): string {
  switch (chainId) {
    case hardhat.id:
      return 'http://127.0.0.1:8545';
    case sepolia.id:
      return (
        process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
      );
    default:
      throw new Error(
        `No browser RPC endpoint is configured for chain ${chainId}. The registry this backend ` +
          `serves is on a chain this build cannot read; deploy to hardhat (${hardhat.id}) or ` +
          `Sepolia (${sepolia.id}), or add the chain here and in wallet-config.ts.`,
      );
  }
}

/** The viem chain definition for a chain id. Same two chains as the wallet. */
export function viemChainFor(chainId: number): Chain {
  switch (chainId) {
    case hardhat.id:
      return hardhat;
    case sepolia.id:
      return sepolia;
    default:
      // Reached only for a chain rpcUrlForChain also rejects; calling it here
      // keeps the two functions from disagreeing about what is supported.
      rpcUrlForChain(chainId);
      throw new Error(`Unsupported chain ${chainId}`);
  }
}

/** A read-only client for the chain this deployment lives on. */
export function publicClientFor(config: PublicChainConfig): PublicClient {
  return createPublicClient({
    chain: viemChainFor(config.chainId),
    transport: http(rpcUrlForChain(config.chainId)),
  });
}
