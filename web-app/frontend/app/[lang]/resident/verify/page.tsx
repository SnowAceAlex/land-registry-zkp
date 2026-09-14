/**
 * app/resident/verify/page.tsx - UC-6, verify a proof.
 *
 * Carries forward the implementation spec from the former app/verifier/page.tsx,
 * which D49 folded into /resident. Verifiers are banks, buyers, agencies.
 *
 * TODO (Phase 9):
 *  1. Accept a proof.json by upload or paste. Parse to
 *     { proof, publicSignals, circuitType }.
 *  2. Check freshness FIRST, via assertTimestampFresh() in shared/datetime.ts.
 *     currentTimestamp is a public input the PROVER picks, so a proof dated back
 *     to when an expired title was still valid verifies perfectly (D26). The
 *     order matters: StaleTimestamp, then InvalidProof, then RootMismatch, the
 *     same three rules under the same three names the contract uses (D33).
 *  3. Off-chain: snarkjs.groth16.verify against
 *     /public/circuits/<type>/verification_key.json for immediate feedback.
 *  4. On-chain: read latestRoot from RootRegistry and call LandRegistryVerifier.
 *     This is an eth_call, so use a viem public client. It needs no wallet, and
 *     the resident portal is logged-out by design (D39, D49).
 *  5. The D30 issuer chain: verify the X.509 signature over the issuer address
 *     with verifyIssuerSignature(), then check the anchored authorityInstitute
 *     hash matches. Chain verification is off-chain on purpose, because
 *     RSA-2048 and P-256 are not secp256k1.
 *  6. Revocation status for the property (D45).
 *  7. Render only the disclosed public signals. Say plainly which fields were
 *     proven and which were never revealed. That distinction is the whole point
 *     of the system and a verifier will not infer it.
 *
 * STATES TO BUILD: idle / parsing / verifying each of the four checks / valid /
 * invalid with the specific failing rule named / chain unreachable.
 */
import { notFound } from 'next/navigation';
import { SquareCheckBig } from 'lucide-react';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { buttonStyles } from '@/components/button';

export default async function ResidentVerifyPage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).residentVerify;

  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description}
      />
      <EmptyState
        icon={SquareCheckBig}
        title={t.emptyTitle}
        description={t.emptyBody}
        action={
          <button type="button" disabled className={buttonStyles.primary}>
            {t.action}
          </button>
        }
      />
    </div>
  );
}
