/**
 * features/resident/shell/chain-config-cache.ts - one /public/config per session.
 *
 * Portal infrastructure rather than `lib/` code: it owns a session lifetime,
 * which `lib/` deliberately does not (D66).
 *
 * WHY A MODULE-LEVEL PROMISE AND NOT A QUERY CLIENT (D61). Both UC-5 and UC-6
 * need the chain id and the two contract addresses, and that answer does not
 * change while a tab is open. The government portal has a
 * `QueryClientProvider` because wagmi requires one; the resident tree has no
 * wallet, no mutations and nothing to poll, so a provider would put a client
 * boundary around all three pages to cache a single immutable fact.
 *
 * A failed load is NOT cached: the backend being briefly unreachable must not
 * leave the page permanently broken, and the screens offer a retry.
 */

import {
  type PublicChainConfig,
  fetchPublicChainConfig,
  publicClientFor,
} from '@/lib/chain-config';
import type { PublicClient } from 'viem';

export interface ChainConfigReady {
  config: PublicChainConfig;
  client: PublicClient;
}

let pending: Promise<ChainConfigReady> | undefined;

/**
 * The chain config and a read-only client for it.
 *
 * Callers share one in-flight request: two screens mounting at once make one
 * HTTP call. `publicClientFor` throws for a chain this build has no endpoint
 * for, and that throw travels with the promise — a deployment on an unknown
 * chain is a real failure the verifier must see, not something to paper over.
 */
export function loadChainConfig(): Promise<ChainConfigReady> {
  if (!pending) {
    pending = (async () => {
      const config = await fetchPublicChainConfig();
      return { config, client: publicClientFor(config) };
    })().catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}

/** Drop the cache so the next call refetches — the retry button, and tests. */
export function resetChainConfigCache(): void {
  pending = undefined;
}
