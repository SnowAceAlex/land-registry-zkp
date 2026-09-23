'use client';

/**
 * features/resident/shell/use-chain-config.ts - the chain config, as a hook.
 *
 * Plain React over the module-level cache (D61): no query client, no provider.
 * Shared by UC-5 (which compares the refreshed root against `latestRoot`) and
 * UC-6 (which does that plus the on-chain verify, the revocation read and the
 * two on-chain links of the D30 issuer chain).
 *
 * An unreachable chain is a first-class state, not an exception to swallow.
 * UC-5 blocks on it — generating a proof against a root nobody published wastes
 * the owner's time — while UC-6 keeps going and marks the chain-dependent
 * checks `unavailable`, so its verdict becomes `unknown` rather than a tick.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PublicClient } from 'viem';

import type { PublicChainConfig } from '@/lib/chain-config';
import { loadChainConfig, resetChainConfigCache } from './chain-config-cache';

export type ChainConfigState =
  | { status: 'loading' }
  | { status: 'ready'; config: PublicChainConfig; client: PublicClient }
  | { status: 'error'; error: unknown };

export interface UseChainConfig {
  state: ChainConfigState;
  retry: () => void;
}

export function useChainConfig(): UseChainConfig {
  const [state, setState] = useState<ChainConfigState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // No synchronous setState here: the initial state is already 'loading', and
  // `retry` sets it back from the event handler. Doing it in the effect body
  // would cascade a render on every mount for no gain.
  useEffect(() => {
    let active = true;

    loadChainConfig().then(
      ({ config, client }) => {
        if (active) setState({ status: 'ready', config, client });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', error });
      },
    );

    // The guard matters on a fast retry: without it a resolved earlier attempt
    // could overwrite a later state.
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    resetChainConfigCache();
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
