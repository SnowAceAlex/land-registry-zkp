/**
 * app/owner/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner Dashboard — Land Use Rights (LUR) management interface.
 *
 * This page allows a land owner to:
 *   1. Connect their wallet (via RainbowKit ConnectButton)
 *   2. View their LUR records
 *   3. Generate a Zero-Knowledge Proof of ownership (client-side via snarkjs)
 *   4. Submit the proof to a verifier or on-chain
 *
 * TODO:
 *  1. Add <ConnectButton /> from @rainbow-me/rainbowkit
 *  2. Use wagmi useAccount() hook to get the connected wallet address
 *  3. Fetch LUR records from backend: import { getRecords } from '@/lib/api'
 *  4. Add a "Generate Proof" button that calls snarkjs via lib/zkp.ts
 *     (proof generation must be client-side to protect the owner's private witness)
 *  5. Display proof status and allow downloading/sharing the proof
 *  6. Add useQuery (TanStack Query) for data fetching with loading/error states
 */
export default function OwnerPage() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-4">Owner Dashboard</h1>
      <p className="text-gray-500 mb-8">
        Manage your Land Use Rights (LUR) records and generate Zero-Knowledge Proofs.
      </p>

      {/* TODO: Replace with actual components */}
      <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
        <p className="text-lg font-medium">Owner dashboard — under construction</p>
        <p className="text-sm mt-2">Connect your wallet to view your land records.</p>
      </div>

      {/*
        TODO: Add the following sections:
        1. <WalletSection />        — ConnectButton + display address
        2. <RecordsList />          — list of LUR records fetched from backend
        3. <ProofGenerator />       — select a record → generate ZKP → display result
        4. <ProofHistory />         — history of generated proofs
      */}
    </main>
  );
}
