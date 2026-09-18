'use client';

/**
 * features/resident/proof/components/proof-workbench.tsx - UC-5, the orchestrator.
 *
 * ⚠️ THE SECRET LIVES HERE AND NOWHERE ELSE. It is held in this component's
 *    state, used to build a witness, and dropped by `startOver()`. It is never
 *    written to storage, never put in a URL, and never sent anywhere — the
 *    feature's whole API surface is one GET (see ../api.ts). Same discipline as
 *    the transfer counter, except that here the browser belongs to the owner,
 *    so the claim has no D47 caveat attached.
 *
 * Which step is showing is decided by `nextProofStage` (D64), a pure function
 * over the facts below, so the ordering is tested in Node rather than inferred
 * from how this component happens to be written.
 */

import { LoaderCircle } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import type { ProofPackage } from '@land-registry/blockchain/shared/types';
import { nowUnixTimestamp } from '@land-registry/blockchain/shared/datetime';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonStyles } from '@/components/ui/button';
import { BundleError, type BundleErrorCode, type OwnerBundle, readBundleFiles } from '@/lib/bundle';
import { readChainRoot } from '@/lib/registry-reads';
import { generateProof } from '@/lib/zkp';

import { type MerkleProofResponse, refreshMerkleProof } from '../api';
import type { IntegrityIssue, IntegrityReport } from '../lib/bundle-integrity';
import { type OwnerProofType, buildOwnerProofInput } from '../lib/owner-witness';
import { isBundleStale, nextProofStage } from '../lib/proof-stage';
import { BundleDropzone } from './bundle-dropzone';
import { IntegrityPanel } from './integrity-panel';
import { ProofResult } from './proof-result';
import { ProofTypePicker } from './proof-type-picker';
import { RecordCard } from './record-card';
import { loadChainConfig, resetChainConfigCache } from '../../shell/chain-config-cache';
import { residentFailure } from '../../shell/resident-error';

type Strings = Dictionary['residentProof'];

export function ProofWorkbench({
  t,
  errors,
  signals,
  shell,
}: {
  t: Strings;
  errors: Dictionary['residentErrors'];
  signals: Dictionary['residentSignals'];
  shell: Dictionary['residentShell'];
}) {
  const [bundle, setBundle] = useState<OwnerBundle | null>(null);
  const [bundleError, setBundleError] = useState<BundleErrorCode | null>(null);
  const [integrityIssues, setIntegrityIssues] = useState<IntegrityIssue[] | null>(null);
  const [record, setRecord] = useState<IntegrityReport | null>(null);
  const [refreshed, setRefreshed] = useState<MerkleProofResponse | null>(null);
  const [chainRoot, setChainRoot] = useState<string | undefined>(undefined);
  const [chainFailed, setChainFailed] = useState(false);
  const [busy, setBusy] = useState<'parsing' | 'refreshing' | 'proving' | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null);

  const [type, setType] = useState<OwnerProofType>('ownership');
  const [years, setYears] = useState('5');
  const [result, setResult] = useState<{ pkg: ProofPackage; durationMs: number } | null>(null);

  const yearsInvalid = !/^\d+$/.test(years.trim());

  function startOver() {
    // Dropping the bundle drops the only copy of the secret this page holds.
    setBundle(null);
    setBundleError(null);
    setIntegrityIssues(null);
    setRecord(null);
    setRefreshed(null);
    setChainRoot(undefined);
    setChainFailed(false);
    setResult(null);
    setFailure(null);
    setBusy(null);
  }

  /**
   * Refresh the Merkle proof and read the chain's root.
   *
   * Awaits the module-level config cache rather than the hook's state, so this
   * runs from an event handler and the component needs no effect at all — the
   * work is caused by the owner picking a file, not by rendering.
   */
  const refresh = useCallback(
    async (propertyId: string) => {
      setBusy('refreshing');
      setChainFailed(false);
      try {
        const { config, client } = await loadChainConfig();
        const [proof, root] = await Promise.all([
          refreshMerkleProof(propertyId),
          readChainRoot(client, config.contracts.RootRegistry),
        ]);
        setRefreshed(proof);
        setChainRoot(root.root);
      } catch (error) {
        // `true`: on this route 410 means revoked and 400 means not issued yet,
        // which read very differently to an owner than a generic failure.
        setFailure(residentFailure(error, errors, true));
        setChainFailed(true);
      } finally {
        setBusy(null);
      }
    },
    [errors],
  );

  async function loadBundle(files: File[]) {
    startOver();
    setBusy('parsing');
    try {
      const loaded = await readBundleFiles(files);
      // Imported here, not at the top: checking the bundle is the only thing on
      // this page that hashes, and circomlibjs costs ~3 MB. Loading it when the
      // owner picks a file keeps the page itself small — which matters most on
      // the phone this is likeliest to be opened on.
      const { checkBundleIntegrity } = await import('../lib/bundle-integrity');
      const report = await checkBundleIntegrity(loaded);
      setBundle(loaded);
      setRecord(report);
      setIntegrityIssues(report.issues);
      setBusy(null);

      // Only worth a network round trip if the file itself is sound.
      if (report.issues.length === 0) await refresh(loaded.receipt.propertyId);
    } catch (error) {
      if (error instanceof BundleError) setBundleError(error.code);
      else setFailure(residentFailure(error, errors));
      setBusy(null);
    }
  }

  const propertyId = bundle?.receipt.propertyId;

  async function prove() {
    if (!bundle || !record || !refreshed) return;
    setBusy('proving');
    setFailure(null);
    try {
      const input = buildOwnerProofInput(type, {
        record: record.record,
        ownerSecret: BigInt(bundle.secret.ownerSecret),
        refreshed,
        currentTimestamp: nowUnixTimestamp(),
        minRemainingTermYears: type === 'mortgage' ? Number(years.trim()) : undefined,
      });
      setResult(await generateProof(type, input));
    } catch (error) {
      setFailure(residentFailure(error, errors));
    } finally {
      setBusy(null);
    }
  }

  function retryChain() {
    resetChainConfigCache();
    setFailure(null);
    if (propertyId) void refresh(propertyId);
  }

  const stage = nextProofStage({
    bundleLoaded: bundle !== null,
    bundleError,
    integrityIssues,
    refreshedRoot: refreshed?.merkleRoot ?? null,
    refreshedInSync: refreshed?.inSync ?? false,
    chainRoot,
    // undefined until a read has been attempted, so the machine waits rather
    // than declaring the chain unreachable before anyone asked it anything.
    chainReachable: chainFailed ? false : chainRoot !== undefined ? true : undefined,
    busy,
    hasResult: result !== null,
  });

  return (
    <div className="space-y-8">
      <Notice tone="info" title={t.privacyBanner} />

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight text-ink">{t.step1}</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.step1Body}</p>

        {bundle === null ? (
          <BundleDropzone
            onFiles={loadBundle}
            label={t.chooseBundle}
            hint={t.dropHint}
            disabled={busy !== null}
          />
        ) : (
          <button type="button" className={buttonStyles.secondary} onClick={startOver}>
            {t.changeBundle}
          </button>
        )}

        {stage === 'parsing' ? (
          <p className="inline-flex items-center gap-2 text-sm text-steel">
            <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
            {t.parsing}
          </p>
        ) : null}

        {bundleError ? (
          <Notice tone="danger" title={t.bundleProblem}>
            {t[`bundle_${bundleError}` as keyof Strings]}
          </Notice>
        ) : null}
      </section>

      {failure ? (
        <Notice tone="danger" title={failure.title}>
          {failure.detail}
        </Notice>
      ) : null}

      {bundle && record ? (
        <>
          <RecordCard record={bundle.receipt.record} t={t} />
          <IntegrityPanel issues={integrityIssues ?? []} t={t} />
        </>
      ) : null}

      {stage === 'refreshing' ? (
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 text-sm text-steel">
            <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
            {t.refreshing}
          </p>
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {stage === 'chain-unavailable' ? (
        <Notice
          tone="warning"
          title={t.chainUnavailableTitle}
          action={
            <button type="button" className={buttonStyles.secondary} onClick={retryChain}>
              {shell.retry}
            </button>
          }
        >
          {t.chainUnavailableBody}
        </Notice>
      ) : null}

      {stage === 'root-not-published' ? (
        <Notice tone="warning" title={t.rootNotPublishedTitle}>
          {t.rootNotPublishedBody}
        </Notice>
      ) : null}

      {/* The BENIGN sense of stale (D64): expected, already repaired, and it
          must never read as an error. */}
      {bundle && refreshed && isBundleStale(bundle.receipt.merkleRoot, refreshed.merkleRoot) ? (
        <Notice tone="info" title={t.staleBundleTitle}>
          {t.staleBundleBody}
        </Notice>
      ) : null}

      {stage === 'ready' || stage === 'proving' ? (
        <>
          <ProofTypePicker
            value={type}
            onChange={setType}
            years={years}
            onYears={setYears}
            yearsInvalid={type === 'mortgage' && yearsInvalid}
            disabled={busy !== null}
            t={t}
          />

          <div className="space-y-2">
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={busy !== null || (type === 'mortgage' && yearsInvalid)}
              onClick={prove}
            >
              {stage === 'proving' ? (
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
                  {t.proving}
                </span>
              ) : (
                t.generate
              )}
            </button>
            <p className="text-xs text-steel">{t.provingHint}</p>
          </div>
        </>
      ) : null}

      {stage === 'done' && result && propertyId ? (
        <ProofResult
          pkg={result.pkg}
          durationMs={result.durationMs}
          type={type}
          propertyId={propertyId}
          onProveAgain={() => setResult(null)}
          t={t}
          signals={signals}
        />
      ) : null}
    </div>
  );
}
