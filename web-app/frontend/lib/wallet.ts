/**
 * lib/wallet.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * wagmi v2 + RainbowKit configuration.
 *
 * TODO:
 *  1. Fill in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env
 *     Get your project ID at: https://cloud.walletconnect.com
 *
 *  2. Configure supported chains:
 *     For development: hardhat local (chainId: 31337)
 *     For testnet:     sepolia (chainId: 11155111)
 *
 *  3. Configure transports (Alchemy/Infura RPC URL or public fallback):
 *     import { http } from 'wagmi'
 *     transport: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL)
 *
 *  4. Wrap app in <WagmiProvider> + <RainbowKitProvider> in app/layout.tsx:
 *     import { WagmiProvider } from 'wagmi'
 *     import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
 *     import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
 *     import { config } from '@/lib/wallet'
 *     import '@rainbow-me/rainbowkit/styles.css'
 *
 * DOCUMENTATION:
 *   wagmi v2 docs:      https://wagmi.sh
 *   RainbowKit docs:    https://www.rainbowkit.com/docs/installation
 */

// uncomment after installing wagmi, viem, @rainbow-me/rainbowkit, @tanstack/react-query

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { hardhat, sepolia } from 'wagmi/chains';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

if (!projectId) {
  console.warn('[wallet.ts] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set');
}

export const wagmiConfig = getDefaultConfig({
  appName: 'Land Registry ZKP',
  projectId,
  chains: [sepolia, hardhat],
  ssr: true, // Required for Next.js App Router
});

