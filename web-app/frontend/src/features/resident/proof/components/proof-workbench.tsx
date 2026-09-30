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
import { useCallback, useMemo, useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { type ProofPackage, TenureType } from '@land-registry/blockchain/shared/types';
import { nowUnixTimestamp } from '@land-registry/blockchain/shared/datetime';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonStyles } from '@/components/ui/button';
import { BundleError, type BundleErrorCode, type OwnerBundle, readBundleFiles } from '@/lib/bundle';
import { readChainRoot, readFrozenOwner } from '@/lib/registry-reads';
import { parseTermYears } from '@/lib/term';
import { generateProof } from '@/lib/zkp';

import { type MerkleProofResponse, refreshMerkleProof } from '../api';
import type { IntegrityIssue, IntegrityReport } from '../lib/bundle-integrity';
import { type OwnerProofType, buildOwnerProofInput } from '../lib/owner-witness';
import { type ProofBlocker, isTitleExpired, proofBlockers } from '../lib/proof-feasibility';
import { isBundleStale, nextProofStage } from '../lib/proof-stage';
import { BundleDropzone } from './bundle-dropzone';
import { IntegrityPanel } from './integrity-panel';
import { ProofResult } from './proof-result';
import { ProofTypePicker } from './proof-type-picker';
import { RecordCard } from './record-card';
import { loadChainConfig, resetChainConfigCache } from '../../shell/chain-config-cache';
import { proverFailure, residentErrorCode, residentFailure } from '../../shell/resident-error';

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
  /** Decided once, when the file is parsed — see loadBundle. */
  const [titleExpired, setTitleExpired] = useState(false);
  const [refreshed, setRefreshed] = useState<MerkleProofResponse | null>(null);
  const [chainRoot, setChainRoot] = useState<string | undefined>(undefined);
  const [frozenOwner, setFrozenOwner] = useState<string | null | undefined>(undefined);
  const [chainFailed, setChainFailed] = useState(false);
  /** The registry said no proof can exist for this plot — revoked or unissued. */
  const [refreshRejected, setRefreshRejected] = useState(false);
  const [busy, setBusy] = useState<'parsing' | 'refreshing' | 'proving' | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null);

  const [type, setType] = useState<OwnerProofType>('ownership');
  const [years, setYears] = useState('5');
  const [result, setResult] = useState<{ pkg: ProofPackage; durationMs: number } | null>(null);

  // One parser for both screens that ask for this number (D70): the counter
  // and this page used to disagree about which strings count as a year.
  const parsedYears = parseTermYears(years);
  const yearsError = 'error' in parsedYears ? parsedYears.error : null;
  const yearsValue = 'years' in parsedYears ? parsedYears.years : null;

  // Its own line rather than a lookup inside the picker: the record card names
  // this fact too, and both have to say the same thing (D70).
  const perpetualTenure = record?.record.tenureType === TenureType.PERPETUAL;

  /**
   * The walls the chosen circuit would hit, named before the owner waits for
   * one (D68). Recomputed when the number changes, which is the moment the
   * term wall can move; the clock is read fresh here rather than reused from
   * load time, since a page can sit open for hours.
   */
  const blockers = useMemo(() => {
    const none: { active: ProofBlocker[]; mortgage: ProofBlocker[] } = { active: [], mortgage: [] };
    if (record === null) return none;
    const now = nowUnixTimestamp();
    return {
      active: proofBlockers(
        type,
        record.record,
        now,
        type === 'mortgage' ? yearsValue : null,
      ),
      // Asked of the mortgage circuit whichever option is selected: the option
      // has to be able to say why it cannot be picked in the first place.
      mortgage: proofBlockers('mortgage', record.record, now, null),
    };
  }, [record, type, yearsValue]);

  const mortgageEncumbered = blockers.mortgage.includes('encumbered');
  const termTooLong = blockers.active.includes('term-too-long');

  function startOver() {
    // Dropping the bundle drops the only copy of the secret this page holds.
    setBundle(null);
    setBundleError(null);
    setIntegrityIssues(null);
    setRecord(null);
    setTitleExpired(false);
    setRefreshed(null);
    setChainRoot(undefined);
    setFrozenOwner(undefined);
    setChainFailed(false);
    setRefreshRejected(false);
    setResult(null);
    setFailure(null);
    setBusy(null);
    // Back to ownership, so the next bundle meets a picker that reflects ITS
    // record. A mortgage selection left over from the previous file would land
    // on an option this one may not be allowed to choose (D68).
    setType('ownership');
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
      setRefreshRejected(false);
      try {
        const { config, client } = await loadChainConfig();
        const [proof, root, frozen] = await Promise.all([
          refreshMerkleProof(propertyId),
          readChainRoot(client, config.contracts.RootRegistry),
          readFrozenOwner(client, config.contracts.RootRegistry, BigInt(propertyId)),
        ]);
        setRefreshed(proof);
        setChainRoot(root.root);
        setFrozenOwner(frozen);
      } catch (error) {
        // `true`: on this route 410 means revoked and 400 means not issued yet,
        // which read very differently to an owner than a generic failure.
        const code = residentErrorCode(error, true);
        setFailure(residentFailure(error, errors, true));
        // Those two are the registry's final answer, not a hiccup: the leaf is
        // not in the tree, so there is no Merkle proof to fetch and no retry
        // that would find one. Everything else is worth offering a retry for.
        setRefreshRejected(code === 'revoked' || code === 'not-issued');
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
      // Read the clock once, here, so the term walls the picker shows and the
      // stage the machine picks are answers to the same question.
      const expired = isTitleExpired(report.record, nowUnixTimestamp());
      setBundle(loaded);
      setRecord(report);
      setIntegrityIssues(report.issues);
      setTitleExpired(expired);
      setBusy(null);

      // Only worth a network round trip if the file itself is sound AND the
      // title could still prove something (D68) — no answer from the registry
      // makes an expired term provable.
      if (report.issues.length === 0 && !expired) await refresh(loaded.receipt.propertyId);
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
        minRemainingTermYears:
          type === 'mortgage' && yearsValue !== null ? yearsValue : undefined,
      });
      setResult(await generateProof(type, input));
    } catch (error) {
      // proverFailure, not residentFailure: a circuit that refuses the witness
      // throws `Assert Failed. Error in template Ownership_226 line: 76`, and
      // putting that on an owner's screen is worse than saying nothing (D68).
      setFailure(proverFailure(error, errors));
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
    titleExpired,
    refreshRejected,
    bundleLeaf: record?.leaf.toString() ?? null,
    registryLeaf: refreshed?.leaf ?? null,
    frozenOwner,
    bundleOwnerCommitment: record ? record.record.ownerCommitment.toString() : null,
    refreshedRoot: refreshed?.merkleRoot ?? null,
    refreshedInSync: refreshed?.inSync ?? false,
    chainRoot,
    // undefined until a read has been attempted, so the machine waits rather
    // than declaring the chain unreachable before anyone asked it anything.
    chainReachable: chainFailed ? false : chainRoot !== undefined ? true : undefined,
    busy,
    hasResult: result !== null,
  });

  /**
   * The dead ends show the reason and nothing else — no record card, no
   * check list, no refresh note. Printing a certificate that the registry has
   * replaced invites the owner to argue with it, and the four green ticks would
   * be read as permission when what they mean is only "the file is intact".
   */
  const deadEnd =
    stage === 'superseded' ||
    stage === 'title-expired' ||
    stage === 'no-proof-possible' ||
    stage === 'owner-frozen';

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

      {stage === 'superseded' ? (
        <Notice tone="danger" title={t.supersededTitle}>
          {t.supersededBody}
        </Notice>
      ) : null}

      {stage === 'owner-frozen' ? (
        <Notice tone="danger" title={t.ownerFrozenTitle}>
          {t.ownerFrozenBody}
        </Notice>
      ) : null}

      {stage === 'title-expired' ? (
        <Notice tone="danger" title={t.titleExpiredTitle}>
          {t.titleExpiredBody}
        </Notice>
      ) : null}

      {bundle && record && !deadEnd ? (
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
          must never read as an error. Suppressed at a dead end, where "this is
          normal and nothing is wrong" would sit directly above the sentence
          saying the opposite — the contradiction the old screen shipped. */}
      {bundle &&
      refreshed &&
      !deadEnd &&
      isBundleStale(bundle.receipt.merkleRoot, refreshed.merkleRoot) ? (
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
            yearsError={type === 'mortgage' ? yearsError : null}
            perpetualTenure={perpetualTenure}
            mortgageEncumbered={mortgageEncumbered}
            termTooLong={termTooLong}
            disabled={busy !== null}
            t={t}
          />

          <div className="space-y-2">
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={
                busy !== null ||
                (type === 'mortgage' && yearsValue === null) ||
                blockers.active.length > 0
              }
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
