/**
 * features/resident/verify/lib/on-chain-verify.ts — ask the contract (D33).
 *
 * The verifier's second, independent verdict. The first is its own snarkjs in
 * the worker; this one is `LandRegistryVerifier` applying the same three rules
 * against `block.timestamp` and `latestRoot`. Neither asks the registry's
 * server anything (D62).
 *
 * All three entry points are `view`, so this is an `eth_call`: no gas, no
 * wallet, no connector. That is what lets a logged-out page do it.
 *
 * ⚠️ THE CONTRACT REVERTS INSTEAD OF RETURNING FALSE (D33). So the happy path
 *    is "readContract did not throw", and the sad path is a decoded custom
 *    error name. `RootMismatch(expected, actual)` and
 *    `StaleTimestamp(claimed, blockTime)` carry arguments — the only place a
 *    verifier learns BY HOW MUCH — so they are surfaced, not swallowed.
 *
 * The (a, b, c) arguments come from `toSolidityCalldata`, which owns the pi_b
 * coordinate swap the EVM pairing precompile needs. Never hand-build them.
 */

import type { Address, PublicClient } from 'viem';

import type { ProofPackage } from '@land-registry/blockchain/shared/types';
// From solidityCalldata, not zkpHelper: this page formats an eth_call and
// proves nothing, and zkpHelper imports snarkjs at the top level.
import { toSolidityCalldata } from '@land-registry/blockchain/shared/solidityCalldata';
import { landRegistryVerifierAbi } from '@/lib/contracts';

export type VerifierRevert =
  | 'InvalidProof'
  | 'RootMismatch'
  | 'StaleTimestamp'
  | 'ZeroAddressDependency'
  /** Nothing decodable — NOT a verdict. See the note in decodeVerifierRevert. */
  | 'Unknown';

export interface DecodedRevert {
  name: VerifierRevert;
  args?: readonly unknown[];
  /** The node's own text, for the detail line. */
  message?: string;
}

const FUNCTIONS = {
  ownership: 'verifyOwnership',
  mortgage: 'verifyMortgage',
  transfer: 'verifyTransfer',
} as const;

const KNOWN: readonly string[] = [
  'InvalidProof',
  'RootMismatch',
  'StaleTimestamp',
  'ZeroAddressDependency',
];

/**
 * Find the contract's own error name in a thrown viem error.
 *
 * Walks the `cause` chain rather than reading a fixed depth, the same technique
 * `walletErrorCode` uses: viem nests a `ContractFunctionRevertedError` at a
 * depth that depends on which layer threw.
 *
 * ⚠️ Returns `Unknown` rather than guessing. Some public RPCs strip revert data,
 *    and a proof whose verdict could not be read must be reported `unavailable`
 *    — calling it invalid would defame a good proof.
 */
export function decodeVerifierRevert(error: unknown): DecodedRevert {
  const message = error instanceof Error ? error.message : undefined;

  for (let node = error as Record<string, unknown> | undefined, depth = 0; node && depth < 10; depth++) {
    const data = node.data as { errorName?: unknown; args?: readonly unknown[] } | undefined;
    const errorName = typeof data?.errorName === 'string' ? data.errorName : undefined;

    if (errorName && KNOWN.includes(errorName)) {
      return { name: errorName as VerifierRevert, args: data?.args, message };
    }

    node = node.cause as Record<string, unknown> | undefined;
  }

  return { name: 'Unknown', message };
}

export type OnChainResult = { ok: true } | { ok: false; revert: DecodedRevert };

export async function verifyOnChain(
  client: PublicClient,
  verifier: Address,
  pkg: ProofPackage,
): Promise<OnChainResult> {
  const { a, b, c } = toSolidityCalldata(pkg.proof);

  try {
    await client.readContract({
      address: verifier,
      abi: landRegistryVerifierAbi,
      functionName: FUNCTIONS[pkg.circuitType],
      args: [
        a.map(BigInt),
        b.map((pair) => pair.map(BigInt)),
        c.map(BigInt),
        pkg.publicSignals.map(BigInt),
      ],
    } as never);
    return { ok: true };
  } catch (error) {
    return { ok: false, revert: decodeVerifierRevert(error) };
  }
}
