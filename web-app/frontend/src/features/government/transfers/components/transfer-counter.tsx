'use client';

/**
 * UC-3 at the counter — the browser twin of transferSmoke.ts, with both
 * parties present and an officer operating (D47).
 *
 *   1. Seller's bundle → shape (lib/bundle) → registry row → seller-check
 *      (leaf recomputes, secret opens the commitment, plot transferable).
 *   2. Buyer's secret, generated here → MUST be downloaded and acknowledged
 *      before anything is submitted (D51): once the change set publishes, a
 *      lost buyer secret makes the plot unprovable forever.
 *   3. Preview → witness from the preview's paths → prove in a Web Worker →
 *      submit. Only the proof and public signals leave this page.
 *
 * Both secrets live only in this component's state and are dropped as soon as
 * the request is submitted or the officer starts over.
 */

import { useState } from 'react';
import { nowUnixTimestamp, poseidonHash } from '@land-registry/blockchain/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { BundleError, type OwnerBundle, readBundleFiles } from '@/lib/bundle';
import { downloadBlob } from '@/lib/download';
import { generateProof } from '@/lib/zkp';

import { type Failure, apiFailure } from '../../api/error-message';
import { useOpenDraft } from '../../api/hooks';
import type { PropertyDetail } from '../../api/types';
import { getPropertyDetail, previewTransfer, submitTransfer } from '../api';
import { buyerSecretArchive, generateOwnerSecret } from '../lib/buyer-secret';
import { type SellerCheckIssue, type SellerCheckResult, checkSellerBundle } from '../lib/seller-check';
import { MAX_TERM_YEARS, parseTermYears, yearsToSeconds } from '@/lib/term';
import { buildCounterTransferInput } from '../lib/transfer-witness';

type Strings = Dictionary['govTransfers'];

interface Seller {
  bundle: OwnerBundle;
  property: PropertyDetail;
  check: SellerCheckResult;
}

interface Buyer {
  secret: bigint;
  commitment: bigint;
  downloadedAs: string | null;
  acknowledged: boolean;
}

type Busy = 'checking' | 'previewing' | 'proving' | 'submitting' | null;

export function TransferCounter({ t, errors }: { t: Strings; errors: Dictionary['govErrors'] }) {
  const queryClient = useQueryClient();
  const openDraft = useOpenDraft();

  const [seller, setSeller] = useState<Seller | null>(null);
  const [issues, setIssues] = useState<SellerCheckIssue[]>([]);
  const [buyer, setBuyer] = useState<Buyer | null>(null);
  const [years, setYears] = useState('0');
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [submitted, setSubmitted] = useState<{ id: number; durationMs: number } | null>(null);
  const [inputKey, setInputKey] = useState(0);

  function startOver() {
    setSeller(null);
    setIssues([]);
    setBuyer(null);
    setYears('0');
    setFailure(null);
    setSubmitted(null);
    setInputKey((key) => key + 1);
  }

  async function loadBundle(files: FileList | null) {
    startOver();
    setBusy('checking');
    try {
      const bundle = await readBundleFiles(files ? [...files] : []);
      const property = await getPropertyDetail(bundle.receipt.propertyId);
      const check = await checkSellerBundle(bundle, property);
      if (check.issues.length > 0) {
        setIssues(check.issues);
      } else {
        setSeller({ bundle, property, check });
      }
    } catch (error) {
      setFailure(
        error instanceof BundleError
          ? { title: t.bundleProblem, detail: t[`bundle_${error.code}`] }
          : apiFailure(error, errors),
      );
    } finally {
      setBusy(null);
    }
  }

  async function createBuyerSecret() {
    const secret = generateOwnerSecret();
    setBuyer({
      secret,
      commitment: await poseidonHash([secret]),
      downloadedAs: null,
      acknowledged: false,
    });
  }

  function downloadBuyerSecret() {
    if (!seller || !buyer) return;
    const { bytes, filename } = buyerSecretArchive(seller.property.propertyId, buyer.secret);
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), filename);
    setBuyer({ ...buyer, downloadedAs: filename });
  }

  // Shared with the owner's mortgage screen (D70), which feeds the same public
  // signal through the same circuit template. The ceiling matters less here —
  // the buyer is standing at the counter holding the seller's certificate — but
  // one threshold cannot be legal on one screen and refused on the other.
  const parsedYears = parseTermYears(years);
  const yearsError = 'error' in parsedYears ? parsedYears.error : null;
  const yearsValue = 'years' in parsedYears ? parsedYears.years : null;
  const canSubmit = Boolean(
    seller && buyer?.downloadedAs && buyer.acknowledged && yearsValue !== null,
  );

  async function proveAndSubmit() {
    if (!seller || !buyer || !canSubmit || yearsValue === null) return;
    const propertyId = seller.property.propertyId;
    setFailure(null);
    try {
      setBusy('previewing');
      const preview = await previewTransfer(propertyId, buyer.commitment.toString());

      const input = buildCounterTransferInput({
        sellerRecord: seller.check.record,
        sellerLeaf: seller.check.leaf,
        sellerSecret: BigInt(seller.bundle.secret.ownerSecret),
        buyerSecret: buyer.secret,
        buyerCommitment: buyer.commitment,
        preview,
        currentTimestamp: nowUnixTimestamp(),
        minRequiredRemainingTerm: yearsToSeconds(yearsValue),
      });

      setBusy('proving');
      let proved: Awaited<ReturnType<typeof generateProof>>;
      try {
        proved = await generateProof('transfer', input);
      } catch (error) {
        setFailure({ title: t.proveFailed, detail: error instanceof Error ? error.message : String(error) });
        return;
      }

      setBusy('submitting');
      const request = await submitTransfer({
        propertyId,
        newOwnerCommitment: buyer.commitment.toString(),
        proof: proved.pkg.proof,
        publicSignals: proved.pkg.publicSignals,
      });

      // The request is queued: the secrets have no further use on this page.
      setSeller(null);
      setBuyer(null);
      setSubmitted({ id: request.id, durationMs: proved.durationMs });
      await queryClient.invalidateQueries({ queryKey: ['gov', 'transfers'] });
    } catch (error) {
      setFailure(apiFailure(error, errors));
    } finally {
      setBusy(null);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <Notice tone="success" title={format(t.submittedTitle, { id: submitted.id })}>
          {format(t.submittedBody, { seconds: (submitted.durationMs / 1000).toFixed(1) })}
        </Notice>
        <button type="button" className={buttonStyles.secondary} onClick={startOver}>
          {t.startAnother}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm leading-relaxed text-steel">{t.counterPrivacy}</p>

      {openDraft.data ? <Notice tone="warning" title={t.draftWarning} /> : null}

      {failure ? (
        <Notice tone="danger" title={failure.title}>
          {failure.detail}
        </Notice>
      ) : null}

      <Step number={1} title={t.step1} active>
        {seller ? (
          <div className="space-y-4">
            <Notice tone="success" title={format(t.sellerVerified, { id: seller.property.propertyId })} />
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="text-steel">{t.fieldAddress}</dt>
              <dd>{seller.property.address}</dd>
              <dt className="text-steel">{t.fieldLandUse}</dt>
              <dd className="font-mono text-xs">{seller.property.landUseCode}</dd>
              <dt className="text-steel">{t.fieldArea}</dt>
              <dd className="font-mono text-xs">{seller.property.area.toFixed(2)} m²</dd>
              <dt className="text-steel">{t.fieldTenure}</dt>
              <dd className="font-mono text-xs">{seller.property.tenureType}</dd>
              <dt className="text-steel">{t.fieldOwner}</dt>
              <dd>
                <HashText value={seller.property.ownerCommitment ?? ''} head={12} tail={8} />
              </dd>
            </dl>
            <button type="button" className={buttonStyles.secondary} disabled={busy !== null} onClick={startOver}>
              {t.changeBundle}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="max-w-prose text-sm leading-relaxed text-steel">{t.step1Body}</p>
            <label className={`${buttonStyles.primary} cursor-pointer`}>
              {busy === 'checking' ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  {t.checkingBundle}
                </>
              ) : (
                t.chooseBundle
              )}
              <input
                key={inputKey}
                type="file"
                multiple
                accept=".zip,.json,application/zip,application/json"
                className="sr-only"
                disabled={busy !== null}
                onChange={(event) => void loadBundle(event.target.files)}
              />
            </label>
            {issues.length > 0 ? (
              <Notice tone="danger" title={t.issuesTitle}>
                <ul className="list-disc space-y-1 pl-4">
                  {issues.map((issue) => (
                    <li key={issue}>{t[`issue_${issue}`]}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
          </div>
        )}
      </Step>

      <Step number={2} title={t.step2} active={Boolean(seller)}>
        {seller ? (
          <div className="space-y-4">
            <p className="max-w-prose text-sm leading-relaxed text-steel">{t.step2Body}</p>
            {buyer ? (
              <>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
                  <dt className="text-steel">{t.buyerCommitment}</dt>
                  <dd>
                    <HashText value={buyer.commitment.toString()} head={12} tail={8} />
                  </dd>
                </dl>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    className={buyer.downloadedAs ? buttonStyles.secondary : buttonStyles.primary}
                    disabled={busy !== null}
                    onClick={downloadBuyerSecret}
                  >
                    {t.downloadSecret}
                  </button>
                  {buyer.downloadedAs ? (
                    <span className="font-mono text-xs text-steel">
                      {format(t.downloadedSecret, { name: buyer.downloadedAs })}
                    </span>
                  ) : null}
                </div>
                <label className="flex items-start gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-authority"
                    disabled={!buyer.downloadedAs || busy !== null}
                    checked={buyer.acknowledged}
                    onChange={(event) => setBuyer({ ...buyer, acknowledged: event.target.checked })}
                  />
                  {t.acknowledge}
                </label>
              </>
            ) : (
              <button type="button" className={buttonStyles.primary} onClick={() => void createBuyerSecret()}>
                {t.generateSecret}
              </button>
            )}
          </div>
        ) : null}
      </Step>

      <Step number={3} title={t.step3} active={Boolean(buyer)}>
        {seller && buyer ? (
          <div className="space-y-4">
            <div className="max-w-xs">
              <label htmlFor="transfer-term" className="block text-sm font-medium text-ink">
                {t.termLabel}
              </label>
              <input
                id="transfer-term"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_TERM_YEARS}
                step={1}
                value={years}
                disabled={busy !== null}
                onChange={(event) => setYears(event.target.value)}
                aria-invalid={yearsError === null ? undefined : true}
                aria-describedby={yearsError === null ? 'transfer-term-hint' : 'transfer-term-error'}
                className="mt-2 w-full rounded-lg border border-hairline bg-white px-3.5 py-2.5 font-mono text-sm ui-transition focus:border-authority"
              />
              {yearsError === null ? (
                <p id="transfer-term-hint" className="mt-2 text-sm text-steel">
                  {t.termHint}
                </p>
              ) : (
                <p id="transfer-term-error" role="alert" className="mt-2 text-sm text-red-700">
                  {yearsError === 'above-max'
                    ? format(t.termAboveMax, { max: MAX_TERM_YEARS })
                    : t.termInvalid}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                className={buttonStyles.primary}
                disabled={!canSubmit || busy !== null}
                onClick={() => void proveAndSubmit()}
              >
                {busy && busy !== 'checking' ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                    {t[busy]}
                  </>
                ) : (
                  t.submit
                )}
              </button>
              {!buyer.downloadedAs || !buyer.acknowledged ? (
                <span className="text-sm text-steel">{t.submitLocked}</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </Step>
    </div>
  );
}

function Step({
  number,
  title,
  active,
  children,
}: {
  number: number;
  title: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`border-t border-whisper pt-5 ${active ? '' : 'opacity-50'}`}>
      <h3 className="flex items-center gap-3 font-medium text-ink">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-hairline font-mono text-xs">
          {number}
        </span>
        {title}
      </h3>
      <div className="mt-4 sm:pl-9">{children}</div>
    </section>
  );
}
