'use client';

/**
 * features/government/wallet/use-registry.ts - RootRegistry through wagmi.
 *
 * Reads go to the deployment's chain (D54) whether or not a wallet is
 * connected, so the resume check "is this draft's root already on chain?"
 * works before the officer has even unlocked Metamask. Writes go through the
 * connected wallet only — the backend holds no signing key (D43).
 */

import { useCallback } from 'react';
import type { Address, Hex } from 'viem';
import { useAccount, useConfig, useReadContract, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';

import type { OpenDraft } from '../api/types';
import { bytes32ToDecimal, publishCallFor, rootRegistryAbi } from './registry';

export interface RegistryTarget {
  address: Address;
  chainId: number;
}

export function useRegistryChain(target: RegistryTarget | undefined) {
  const { address: account, isConnected, chainId: walletChainId } = useAccount();

  const latestRoot = useReadContract({
    address: target?.address,
    chainId: target?.chainId,
    abi: rootRegistryAbi,
    functionName: 'latestRoot',
    query: { enabled: Boolean(target), refetchInterval: 10_000 },
  });

  const authorityRole = useReadContract({
    address: target?.address,
    chainId: target?.chainId,
    abi: rootRegistryAbi,
    functionName: 'STATE_AUTHORITY_ROLE',
    query: { enabled: Boolean(target) },
  });

  const hasRole = useReadContract({
    address: target?.address,
    chainId: target?.chainId,
    abi: rootRegistryAbi,
    functionName: 'hasRole',
    args: authorityRole.data && account ? [authorityRole.data, account] : undefined,
    query: { enabled: Boolean(target && authorityRole.data && account) },
  });

  const refetch = useCallback(async () => {
    await Promise.all([latestRoot.refetch(), hasRole.refetch()]);
  }, [latestRoot, hasRole]);

  return {
    latestRoot: latestRoot.data ? bytes32ToDecimal(latestRoot.data) : undefined,
    latestRootError: latestRoot.error,
    hasRole: account ? hasRole.data : undefined,
    account,
    isConnected,
    walletChainId,
    refetch,
  };
}

/** Wait for a transaction's block; a mined-but-reverted transaction is a failure. */
function useWaitMined() {
  const config = useConfig();
  return useCallback(
    async (target: RegistryTarget, hash: Hex): Promise<void> => {
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: target.chainId });
      if (receipt.status !== 'success') {
        throw new Error(`Transaction ${hash} was mined but reverted`);
      }
    },
    [config],
  );
}

/**
 * Publish a draft's root from the connected wallet. Split in two so the screen
 * can tell "waiting for the wallet" from "waiting for the block": `send` resolves
 * once the officer signs, `waitMined` once the transaction is in a block.
 */
export function usePublishDraft() {
  const { writeContractAsync } = useWriteContract();
  const waitMined = useWaitMined();

  const send = useCallback(
    async (target: RegistryTarget, draft: OpenDraft): Promise<Hex> => {
      const call = publishCallFor(draft);
      const base = { address: target.address, chainId: target.chainId, abi: rootRegistryAbi };
      return call.functionName === 'publishRoot'
        ? writeContractAsync({ ...base, functionName: 'publishRoot', args: call.args })
        : writeContractAsync({
            ...base,
            functionName: 'publishRootWithRevocations',
            args: call.args,
          });
    },
    [writeContractAsync],
  );

  return { send, waitMined };
}
