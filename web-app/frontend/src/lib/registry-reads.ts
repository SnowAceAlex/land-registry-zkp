/**
 * lib/registry-reads.ts - the RootRegistry reads both resident screens need.
 *
 * Every function here is a `view` call, so this is `eth_call` only: no gas, no
 * wallet, no connector (D61). Promoted to shared code because UC-5 needs the
 * current root and UC-6 needs all four, and sibling features must not import
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

export interface RevocationEntry {
  reasonCode: number;
  detailHash: Hex;
  rootVersion: number;
  /** Unix seconds. Never 0 in a returned entry — see the null case below. */
  revokedAt: bigint;
}

/**
 * The public revocation record for a property (D45), or null if there is none.
 *
 * Solidity mappings have no "absent": an unrevoked property reads back as an
 * all-zero struct. `revokedAt === 0` is therefore the sentinel for "no entry",
 * and it is resolved here rather than in each screen — a zeroed struct rendered
 * as a revocation would accuse a live title.
 *
 * Note what this is *for*. Enforcement already comes from removing the leaf: no
 * Merkle path exists, so no proof can be produced. This list exists for public
 * auditability, which is why the reason is a code plus an off-chain-detail hash
 * rather than free text.
 */
export async function readRevocation(
  client: PublicClient,
  registry: Address,
  propertyId: bigint,
): Promise<RevocationEntry | null> {
  const entry = (await client.readContract({
    address: registry,
    abi: rootRegistryAbi,
    functionName: 'revocations',
    args: [propertyId],
  })) as readonly [number, Hex, bigint, bigint];

  const [reasonCode, detailHash, rootVersion, revokedAt] = entry;
  if (revokedAt === 0n) return null;

  return {
    reasonCode: Number(reasonCode),
    detailHash,
    rootVersion: Number(rootVersion),
    revokedAt,
  };
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
