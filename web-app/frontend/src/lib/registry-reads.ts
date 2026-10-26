/**
 * lib/registry-reads.ts - the RootRegistry reads both resident screens need.
 *
 * Every function here is a `view` call, so this is `eth_call` only: no gas, no
 * wallet, no connector (D61). Promoted to shared code because UC-5 needs the
 * current root and UC-6 needs the rest, and sibling features must not import
 * each other (D66).
 *
 * Roots come back as DECIMAL STRINGS, not hex. That is the form the API, the
 * `receipt.json` and a proof's `publicSignals` all speak; `bytes32ToDecimal`
 * does the conversion once, here, so no screen compares a hex root to a decimal
 * one and concludes RootMismatch.
 */

import type { Address, Hex, PublicClient } from 'viem';

import { bytes32ToDecimal, rootRegistryAbi } from './contracts';

export interface ChainRoot {
  /** RootRegistry.latestRoot(), decimal. '0' before anything is published. */
  root: string;
  /** RootRegistry.rootVersion(); 0 = nothing published yet. */
  version: number;
  /** Block timestamp of the last publish, seconds. */
  lastUpdatedAt: bigint;
}

/** The root a proof must match to be accepted anywhere (D33). */
export async function readChainRoot(client: PublicClient, registry: Address): Promise<ChainRoot> {
  const [root, version, lastUpdatedAt] = await Promise.all([
    client.readContract({ address: registry, abi: rootRegistryAbi, functionName: 'latestRoot' }),
    client.readContract({ address: registry, abi: rootRegistryAbi, functionName: 'rootVersion' }),
    client.readContract({ address: registry, abi: rootRegistryAbi, functionName: 'lastUpdatedAt' }),
  ]);

  return {
    root: bytes32ToDecimal(root as Hex),
    version: Number(version),
    lastUpdatedAt: lastUpdatedAt as bigint,
  };
}

/** D91: whether the chain has revoked the plot (one bit per id); the reason is in its event. */
export async function readIsRevoked(
  client: PublicClient,
  registry: Address,
  propertyId: bigint,
): Promise<boolean> {
  return (await client.readContract({
    address: registry,
    abi: rootRegistryAbi,
    functionName: 'isRevoked',
    args: [propertyId],
  })) as boolean;
}

/** D82: whether `account` may sign status attestations — read from the chain, never the backend. */
export async function readIsAttester(
  client: PublicClient,
  registry: Address,
  account: Address,
): Promise<boolean> {
  const role = (await client.readContract({
    address: registry,
    abi: rootRegistryAbi,
    functionName: 'ATTESTER_ROLE',
  })) as Hex;
  return (await client.readContract({
    address: registry,
    abi: rootRegistryAbi,
    functionName: 'hasRole',
    args: [role, account],
  })) as boolean;
}

export interface AuthorityAnchor {
  /** keccak256 of the X.509 organization name anchored for this account (D30). */
  instituteHash: Hex;
  /** Whether the account may publish roots at all. */
  hasAuthorityRole: boolean;
}

/**
 * The two on-chain halves of the D30 issuer chain, for the account a receipt
 * names as its publisher.
 *
 * Sequential rather than a multicall: hardhat's default deployment has no
 * multicall3, and two `eth_call`s against a local node are not worth a branch.
 */
export async function readAuthorityAnchor(
  client: PublicClient,
  registry: Address,
  account: Address,
): Promise<AuthorityAnchor> {
  const role = (await client.readContract({
    address: registry,
    abi: rootRegistryAbi,
    functionName: 'STATE_AUTHORITY_ROLE',
  })) as Hex;

  const [instituteHash, hasAuthorityRole] = await Promise.all([
    client.readContract({
      address: registry,
      abi: rootRegistryAbi,
      functionName: 'authorityInstitute',
      args: [account],
    }),
    client.readContract({
      address: registry,
      abi: rootRegistryAbi,
      functionName: 'hasRole',
      args: [role, account],
    }),
  ]);

  return {
    instituteHash: instituteHash as Hex,
    hasAuthorityRole: hasAuthorityRole as boolean,
  };
}
