/**
 * features/government/wallet/wallet-config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * wagmi v2 + RainbowKit configuration for the government portal.
 *
 * The officer's wallet signs every on-chain write (D43); which chain and which
 * RootRegistry it signs against are NOT configured here but read from
 * GET /government/status (D54), and the portal refuses to sign from any other
 * chain. Both chains the project deploys to are listed so wagmi can read the
 * registry on either one before a wallet is even connected:
 *   - hardhat (31337) at http://127.0.0.1:8545 for local development;
 *   - sepolia (11155111), public RPC unless NEXT_PUBLIC_SEPOLIA_RPC_URL is set.
 *
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (cloud.walletconnect.com) enables the
 * WalletConnect connector; Metamask in the browser works without it.
 *
 * Mounted by features/government/wallet/wallet-providers.tsx, from
 * app/[lang]/government/layout.tsx only — never on the resident pages.
 */

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { hardhat, sepolia } from 'wagmi/chains';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

if (!projectId) {
  console.warn('[wallet-config.ts] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set');
}

export const wagmiConfig = getDefaultConfig({
  appName: 'Land Registry ZKP',
  projectId,
  chains: [hardhat, sepolia],
  transports: {
    [hardhat.id]: http(),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || undefined),
  },
  ssr: true, // Required for Next.js App Router
});

