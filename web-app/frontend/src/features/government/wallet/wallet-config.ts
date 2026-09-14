/**
 * features/government/wallet/wallet-config.ts
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
 *  (Done) The <WagmiProvider> + <RainbowKitProvider> wrapper is
 *     wallet-providers.tsx, mounted by app/[lang]/government/layout.tsx only.
 *
 * DOCUMENTATION:
 *   wagmi v2 docs:      https://wagmi.sh
 *   RainbowKit docs:    https://www.rainbowkit.com/docs/installation
 */

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { hardhat, sepolia } from 'wagmi/chains';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

if (!projectId) {
  console.warn('[wallet-config.ts] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set');
}

export const wagmiConfig = getDefaultConfig({
  appName: 'Land Registry ZKP',
  projectId,
  chains: [sepolia, hardhat],
  ssr: true, // Required for Next.js App Router
});

