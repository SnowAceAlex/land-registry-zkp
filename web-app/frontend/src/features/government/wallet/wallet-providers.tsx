'use client';

/**
 * features/government/wallet/wallet-providers.tsx - wallet + query providers.
 *
 * Mounted by app/[lang]/government/layout.tsx ONLY, never by the root layout.
 * D43 makes Metamask the signer for every on-chain write, but that is a
 * government-portal concern: the resident portal is logged-out by design (D39,
 * D49) and its on-chain verify is an `eth_call` through a public client, which
 * needs no connector. Hoisting this to the root layout put ~665 KB of wallet
 * code on the landing page and on all three resident pages.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from './wallet-config';
import '@rainbow-me/rainbowkit/styles.css';

export function WalletProviders({ children }: { children: React.ReactNode }) {
  // One client per mount, created lazily so it is never shared across requests.
  const [queryClient] = React.useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
