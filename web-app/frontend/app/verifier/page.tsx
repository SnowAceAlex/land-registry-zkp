/**
 * app/verifier/page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifier Interface — Selective disclosure proof verification.
 *
 * This page allows a verifier (bank, government agency, third party) to:
 *   1. Receive a proof package from an owner (via QR code, file upload, or API)
 *   2. Verify the proof off-chain (client-side via snarkjs) for immediate feedback
 *   3. Cross-check the Merkle root against the on-chain RootRegistry contract
 *   4. View only the disclosed attributes (selective disclosure — no private data)
 *
 * Example use cases:
 *   - Bank verifying property is unencumbered (mortgage.circom proof)
 *   - Government verifying property ownership (ownership.circom proof)
 *   - Transfer registry verifying old → new ownership (transfer.circom proof)
 *
 * TODO:
 *  1. Add proof upload / paste area (accept JSON proof file or text input)
 *  2. Parse proof into { proof, publicSignals, circuitType }
 *  3. Fetch the verification key for the circuit type from /public/circuits/<type>/verification_key.json
 *  4. Call snarkjs.groth16.verify(vkey, publicSignals, proof) → boolean
 *  5. Display the public signals (disclosed attributes) in a human-readable format
 *  6. Use wagmi + viem to read latestRoot from RootRegistry contract and compare
 *  7. Show a clear VALID / INVALID result with on-chain confirmation
 */
export default function VerifierPage() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-4">Proof Verifier</h1>
      <p className="text-gray-500 mb-8">
        Verify a Zero-Knowledge Proof of land use rights without seeing private record data.
      </p>

      {/* TODO: Replace with actual components */}
      <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center text-gray-400">
        <p className="text-lg font-medium">Verifier interface — under construction</p>
        <p className="text-sm mt-2">Upload or paste a proof to verify ownership claims.</p>
      </div>

      {/*
        TODO: Add the following sections:
        1. <ProofUpload />       — drag & drop or paste JSON proof
        2. <VerificationStatus /> — VALID / INVALID indicator
        3. <PublicSignals />     — display the disclosed attributes (public signals)
        4. <OnChainCheck />      — compare root against RootRegistry.latestRoot()
      */}
    </main>
  );
}
