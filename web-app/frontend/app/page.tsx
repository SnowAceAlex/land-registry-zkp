import Link from "next/link";

/**
 * Home page — Land Registry ZKP project landing page.
 * Provides navigation to the two main user roles:
 *   - /owner     (land owner dashboard)
 *   - /verifier  (proof verifier interface)
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="max-w-2xl w-full text-center space-y-6">
        {/* Title */}
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Land Registry ZKP
        </h1>
        <p className="text-lg text-zinc-500 dark:text-zinc-400">
          Privacy-preserving Land Use Rights management using{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Merkle tree + Zero-Knowledge Proofs (Groth16)
          </span>{" "}
          on Ethereum.
        </p>

        {/* Role navigation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
          <Link
            href="/owner"
            className="group flex flex-col gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-left hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
          >
            <span className="text-2xl">🏠</span>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Owner Dashboard
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              View your Land Use Rights records and generate Zero-Knowledge
              Proofs of ownership.
            </span>
          </Link>

          <Link
            href="/verifier"
            className="group flex flex-col gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-left hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
          >
            <span className="text-2xl">🔍</span>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Proof Verifier
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              Verify a Zero-Knowledge Proof without seeing the owner&apos;s
              private record data.
            </span>
          </Link>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap justify-center gap-2 pt-2 text-xs text-zinc-400">
          <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1">
            Hardhat + Solidity
          </span>
          <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1">
            circom + snarkjs (Groth16)
          </span>
          <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1">
            NestJS + Prisma
          </span>
          <span className="rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1">
            wagmi + RainbowKit
          </span>
        </div>
      </div>
    </main>
  );
}

