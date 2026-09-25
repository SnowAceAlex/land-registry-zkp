/**
 * features/resident/verify/lib/trust-summary.ts — the verdict a person acts on.
 *
 * WHY THIS IS SEPARATE FROM THE PIPELINE. The four checks answer "is this proof
 * valid". That is not the question a buyer or a bank actually has, which is
 * "should I act on this". The two come apart in both directions, and this
 * module is where the system can say so:
 *
 *  - a cryptographically perfect proof on a REVOKED plot is `reject`. Nothing
 *    is wrong with the proof; the title behind it has been withdrawn (D45);
 *  - a perfect proof whose issuer's organization hash does not match the
 *    on-chain anchor is `reject`. The proof is fine; the registry that
 *    published its root is not the authority it claims to be (D30);
 *  - a perfect proof whose issuer certificate the pinned root did not issue
 *    is `reject` too (D78) — a self-signed or foreign-CA certificate is exactly
 *    what an impostor would present;
 *  - a perfect proof checked by a verifier with NO pinned root is
 *    `accept-with-warning`, never a clean accept: link 1 could not run;
 *  - an unreachable chain is `unknown`, not `accept`. Half the checks did not
 *    run, and a green tick would be a lie.
 *
 * Pure, so every one of those combinations is a test rather than a screen that
 * has to be driven by hand.
 */

import type { RevocationEntry } from '@/lib/registry-reads';

import type { IssuerChainReport } from './issuer-chain';
import type { PipelineStep } from './proof-pipeline';

export type TrustVerdict = 'accept' | 'accept-with-warning' | 'reject' | 'unknown';

export type TrustReason =
  | 'proof-rejected'
  | 'property-revoked'
  | 'issuer-mismatch'
  | 'issuer-unverified'
  | 'issuer-not-supplied'
  | 'chain-unavailable'
  | 'checks-incomplete';

export interface TrustFacts {
  step: PipelineStep;
  /** null when the plot carries no on-chain revocation; undefined if unread. */
  revocation: RevocationEntry | null | undefined;
  /** null when the verifier supplied no receipt. */
  issuer: IssuerChainReport | null;
  chainReachable: boolean | undefined;
}

export interface TrustSummary {
  verdict: TrustVerdict;
  reasons: TrustReason[];
}

export function summariseTrust(f: TrustFacts): TrustSummary {
  const reasons: TrustReason[] = [];

  // A broken rule is decisive: nothing else can rescue it.
  if (f.step.kind === 'rejected') {
    return { verdict: 'reject', reasons: ['proof-rejected'] };
  }

  // The issuer's identity being WRONG is as decisive as a bad proof — it means
  // the root was published by someone the registry never anchored.
  const issuerMismatch =
    f.issuer !== null &&
    (f.issuer.links.organization === 'fail' ||
      f.issuer.links.role === 'fail' ||
      f.issuer.links.signature === 'fail' ||
      f.issuer.links.certificate === 'fail');

  const revoked = f.revocation != null;

  if (revoked || issuerMismatch) {
    if (revoked) reasons.push('property-revoked');
    if (issuerMismatch) reasons.push('issuer-mismatch');
    return { verdict: 'reject', reasons };
  }

  // Nothing is wrong, but not everything could be checked.
  if (f.chainReachable === false) reasons.push('chain-unavailable');
  if (f.step.kind !== 'done') reasons.push('checks-incomplete');

  if (reasons.length > 0) return { verdict: 'unknown', reasons };

  if (f.issuer === null) {
    return { verdict: 'accept-with-warning', reasons: ['issuer-not-supplied'] };
  }

  // No pinned root (D78): link 1 could not run, so the issuer's identity is
  // only as good as links 2–4, which an impostor with their own certificate
  // passes too. Never a clean `accept`.
  if (f.issuer.links.certificate === 'not-verifiable') {
    return { verdict: 'accept-with-warning', reasons: ['issuer-unverified'] };
  }

  return { verdict: 'accept', reasons: [] };
}
