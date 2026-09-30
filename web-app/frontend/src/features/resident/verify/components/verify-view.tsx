/**
 * features/resident/verify/components/verify-view.tsx - UC-6, verify a proof.
 *
 * Verifiers are banks, buyers, agencies. Implemented in Phase 9; what the
 * original TODO asked for, and where it went:
 *
 *  1. A proof.json is accepted by upload or paste and parsed by
 *     `lib/proof-file.ts` into { proof, publicSignals, circuitType } — inferred
 *     from the signal count when the file omits it, and refused rather than
 *     reinterpreted when the file contradicts itself.
 *  2. Freshness is checked FIRST, via `isTimestampFresh`. currentTimestamp is a
 *     public input the PROVER picks, so a proof dated back to when an expired
 *     title was still valid verifies perfectly (D26). The order is the
 *     contract's own — StaleTimestamp, then InvalidProof, then RootMismatch
 *     (D33) — and lives in the pure `lib/proof-pipeline.ts`.
 *  3. Off-chain: snarkjs in the Web Worker, against this deployment's
 *     verification_key.json, through `verifyGroth16ProofWithKey` (D59).
 *  4. On-chain: `lib/on-chain-verify.ts` reads LandRegistryVerifier with a
 *     plain viem public client. It is an eth_call, so it needs no wallet, and
 *     the resident portal is logged-out by design (D39, D49). Nothing here
 *     imports from features/government/wallet.
 *  5. The D30 issuer chain is `lib/issuer-chain.ts`: @peculiar/x509 plus
 *     WebCrypto, reusing only `issuerSignatureMessage` from the Node-only
 *     shared module. Chain verification is off-chain on purpose, because
 *     RSA-2048 and P-256 are not secp256k1.
 *  6. Revocation status comes from the chain's own `revocations` mapping (D45),
 *     not from the registry's API, and is shown through the verdict.
 *  7. Only the disclosed public signals are rendered, beside an explicit list
 *     of what was never revealed. That distinction is the whole point of the
 *     system and a verifier will not infer it.
 *
 *  The states the TODO listed — idle / parsing / each check / valid / invalid
 *  with the failing rule named / chain unreachable — are the step machine, and
 *  `lib/trust-summary.ts` turns them into the verdict a person acts on.
 */

import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { VerifyWorkbench } from './verify-workbench';

export function VerifyView({
  t,
  errors,
  signals,
  shell,
}: {
  t: Dictionary['residentVerify'];
  errors: Dictionary['residentErrors'];
  signals: Dictionary['residentSignals'];
  shell: Dictionary['residentShell'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <VerifyWorkbench t={t} errors={errors} signals={signals} shell={shell} />
    </div>
  );
}
