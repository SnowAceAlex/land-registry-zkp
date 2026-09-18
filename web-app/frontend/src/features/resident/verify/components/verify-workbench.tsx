'use client';

/**
 * features/resident/verify/components/verify-workbench.tsx — UC-6, the orchestrator.
 *
 * ⚠️ THIS PAGE NEVER ASKS THE REGISTRY WHETHER A PROOF IS VALID (D62). Its two
 *    verdicts are its own snarkjs, in the worker, and LandRegistryVerifier's
 *    eth_call. `POST /api/proof/verify` still exists for machine-to-machine
 *    callers, but a verifier that consults the registry has put back the
 *    trusted third party this design removes. The only backend call on this
 *    screen is GET /api/public/config, for the contract addresses.
 *
 * The checks run in the order `nextVerificationStep` dictates (D63), one at a
 * time, driven from the handler rather than an effect: the work is caused by
 * the verifier pressing a button, not by rendering.
 */

import { FileText, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import type { ProofPackage } from '@land-registry/blockchain/shared/types';
import {
  isTimestampFresh,
  nowUnixTimestamp,
} from '@land-registry/blockchain/shared/datetime';
import {
  publicSignalIndex,
  rootSignalName,
} from '@land-registry/blockchain/shared/circuitInputs';
import type { Receipt } from '@land-registry/blockchain/shared/receipt';
import { Notice } from '@/components/ui/notice';
import { buttonStyles } from '@/components/ui/button';
import { ProofFileError, parseProofFile } from '@/lib/proof-file';
import { type RevocationEntry, readChainRoot, readRevocation } from '@/lib/registry-reads';
import { ArtifactMissingError, verifyProofOffChain } from '@/lib/zkp';

import { CheckList } from './check-list';
import { DisclosurePanel } from './disclosure-panel';
import { IssuerChainPanel } from './issuer-chain-panel';
import { RevocationPanel } from './revocation-panel';
import { type IssuerChainReport, verifyIssuerChain } from '../lib/issuer-chain';
import { verifyOnChain } from '../lib/on-chain-verify';
import {
  type CheckName,
  type CheckState,
  initialChecks,
  nextVerificationStep,
} from '../lib/proof-pipeline';
import { summariseTrust } from '../lib/trust-summary';
import { loadChainConfig, resetChainConfigCache } from '../../shell/chain-config-cache';
import { residentFailure } from '../../shell/resident-error';
import type { ProofRejectionReason } from '@/lib/api-client';

type Strings = Dictionary['residentVerify'];

const VERDICT_KEYS = {
  accept: 'verdict_accept',
  'accept-with-warning': 'verdict_accept-with-warning',
  reject: 'verdict_reject',
  unknown: 'verdict_unknown',
} as const;

export function VerifyWorkbench({
  t,
  errors,
  signals,
  revocationStrings,
  shell,
}: {
  t: Strings;
  errors: Dictionary['residentErrors'];
  signals: Dictionary['residentSignals'];
  revocationStrings: Dictionary['residentRevocation'];
  shell: Dictionary['residentShell'];
}) {
  const [text, setText] = useState('');
  const [pkg, setPkg] = useState<ProofPackage | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<CheckName, CheckState>>(initialChecks());
  const [rejection, setRejection] = useState<ProofRejectionReason | undefined>(undefined);
  const [chainReachable, setChainReachable] = useState<boolean | undefined>(undefined);
  const [artifactsMissing, setArtifactsMissing] = useState(false);
  const [revocation, setRevocation] = useState<RevocationEntry | null | undefined>(undefined);
  const [issuer, setIssuer] = useState<IssuerChainReport | null>(null);
  const [contractMatches, setContractMatches] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ title: string; detail?: string } | null>(null);

  const set = (check: CheckName, state: CheckState) =>
    setChecks((current) => ({ ...current, [check]: state }));

  function reset() {
    setPkg(null);
    setProofError(null);
    setChecks(initialChecks());
    setRejection(undefined);
    setChainReachable(undefined);
    setArtifactsMissing(false);
    setRevocation(undefined);
    setIssuer(null);
    setContractMatches(undefined);
    setFailure(null);
  }

  /** Run all four checks, stopping at the first that fails (D63). */
  async function runChecks(parsed: ProofPackage) {
    const { circuitType, publicSignals, proof } = parsed;

    // 1. Freshness FIRST — the only check that catches a replayed proof (D26).
    set('freshness', 'running');
    const claimed = BigInt(publicSignals[publicSignalIndex(circuitType, 'currentTimestamp')]);
    if (!isTimestampFresh(claimed, nowUnixTimestamp())) {
      set('freshness', 'fail');
      setRejection('StaleTimestamp');
      return;
    }
    set('freshness', 'pass');

    // 2. Cryptographic — in this browser, against this deployment's vkey.
    set('cryptographic', 'running');
    try {
      const { valid } = await verifyProofOffChain(circuitType, publicSignals, proof);
      if (!valid) {
        set('cryptographic', 'fail');
        setRejection('InvalidProof');
        return;
      }
      set('cryptographic', 'pass');
    } catch (error) {
      // A missing artifact is not a verdict: the contract can still answer.
      if (error instanceof ArtifactMissingError) {
        setArtifactsMissing(true);
        set('cryptographic', 'unavailable');
      } else {
        set('cryptographic', 'unavailable');
        setFailure(residentFailure(error, errors));
      }
    }

    // 3 and 4 need the chain.
    let config;
    let client;
    try {
      ({ config, client } = await loadChainConfig());
      setChainReachable(true);
    } catch (error) {
      setChainReachable(false);
      set('rootMatchesChain', 'unavailable');
      set('onChain', 'unavailable');
      setFailure(residentFailure(error, errors));
      return;
    }

    // 3. The root it proves against must be the published one. For a transfer
    // that is `oldMerkleRoot` — exactly what verifyTransfer compares.
    set('rootMatchesChain', 'running');
    try {
      const [chain, entry] = await Promise.all([
        readChainRoot(client, config.contracts.RootRegistry),
        readRevocation(
          client,
          config.contracts.RootRegistry,
          BigInt(publicSignals[publicSignalIndex(circuitType, 'propertyId')]),
        ),
      ]);
      setRevocation(entry);

      const claimedRoot = publicSignals[publicSignalIndex(circuitType, rootSignalName(circuitType))];
      if (claimedRoot !== chain.root) {
        set('rootMatchesChain', 'fail');
        setRejection('RootMismatch');
        return;
      }
      set('rootMatchesChain', 'pass');
    } catch (error) {
      set('rootMatchesChain', 'unavailable');
      set('onChain', 'unavailable');
      setFailure(residentFailure(error, errors));
      return;
    }

    // 4. The contract's own opinion.
    set('onChain', 'running');
    const result = await verifyOnChain(client, config.contracts.LandRegistryVerifier, parsed);
    if (result.ok) {
      set('onChain', 'pass');
      return;
    }
    // A revert the node stripped tells us nothing — `unavailable`, not `fail`.
    if (result.revert.name === 'Unknown' || result.revert.name === 'ZeroAddressDependency') {
      set('onChain', 'unavailable');
      setFailure({ title: errors.unavailable, detail: result.revert.message });
      return;
    }
    set('onChain', 'fail');
    setRejection(result.revert.name);
  }

  async function checkProof() {
    reset();
    setBusy(true);
    try {
      const parsed = parseProofFile(text);
      setPkg(parsed);
      await runChecks(parsed);
    } catch (error) {
      if (error instanceof ProofFileError) {
        setProofError(t[`proof_${error.code}` as keyof Strings]);
      } else {
        setFailure(residentFailure(error, errors));
      }
    } finally {
      setBusy(false);
    }
  }

  async function readFile(files: File[], onText: (value: string) => void) {
    const file = files[0];
    if (file) onText(await file.text());
  }

  /** The optional receipt — the D30 identity chain, and nothing else. */
  async function loadReceipt(files: File[]) {
    try {
      const raw = await files[0]?.text();
      if (!raw) return;
      const receipt = JSON.parse(raw) as Receipt;
      const { config, client } = await loadChainConfig();

      setContractMatches(
        receipt.contractAddress.toLowerCase() === config.contracts.RootRegistry.toLowerCase(),
      );
      setIssuer(
        await verifyIssuerChain({
          issuer: receipt.issuer,
          client,
          registry: config.contracts.RootRegistry,
        }),
      );
    } catch (error) {
      setFailure(residentFailure(error, errors));
    }
  }

  const step = nextVerificationStep({
    parsed: pkg !== null,
    checks,
    chainReachable,
    artifactsMissing,
    rejection,
  });

  const trust = summariseTrust({ step, revocation, issuer, chainReachable });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight text-ink">{t.inputTitle}</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.inputBody}</p>

        <label htmlFor="proof-json" className="block text-sm text-ink">
          {t.pasteLabel}
        </label>
        <textarea
          id="proof-json"
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby="proof-json-hint"
          className="w-full rounded-lg border border-hairline bg-white px-3 py-2 font-mono text-xs text-ink ui-transition focus:border-authority"
        />
        <p id="proof-json-hint" className="text-xs text-steel">
          {t.pasteHint}
        </p>

        <div className="flex flex-wrap gap-3">
          <label className={`${buttonStyles.secondary} cursor-pointer`}>
            <span className="inline-flex items-center gap-2">
              <FileText className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {t.chooseProof}
            </span>
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                void readFile(files, setText);
              }}
            />
          </label>

          <button
            type="button"
            className={buttonStyles.primary}
            disabled={busy || text.trim() === ''}
            onClick={checkProof}
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
                {t.parsing}
              </span>
            ) : (
              t.parse
            )}
          </button>

          {pkg ? (
            <button type="button" className={buttonStyles.secondary} onClick={reset}>
              {t.startOver}
            </button>
          ) : null}
        </div>

        {proofError ? (
          <Notice tone="danger" title={t.proofProblem}>
            {proofError}
          </Notice>
        ) : null}
      </section>

      {failure ? (
        <Notice
          tone="warning"
          title={failure.title}
          action={
            <button
              type="button"
              className={buttonStyles.secondary}
              onClick={() => {
                resetChainConfigCache();
                setFailure(null);
              }}
            >
              {shell.retry}
            </button>
          }
        >
          {failure.detail}
        </Notice>
      ) : null}

      {pkg ? (
        <>
          <Notice
            tone={
              trust.verdict === 'reject'
                ? 'danger'
                : trust.verdict === 'accept'
                  ? 'success'
                  : 'warning'
            }
            title={`${t.verdictTitle}: ${t[VERDICT_KEYS[trust.verdict]]}`}
          >
            <ul className="space-y-1">
              {trust.reasons.map((reason) => (
                <li key={reason}>{t[`reason_${reason}` as keyof Strings]}</li>
              ))}
            </ul>
          </Notice>

          <CheckList checks={checks} step={step} t={t} />

          <DisclosurePanel
            circuitType={pkg.circuitType}
            publicSignals={pkg.publicSignals}
            t={t}
            signals={signals}
          />

          <RevocationPanel entry={revocation} t={t} revocation={revocationStrings} />

          <IssuerChainPanel
            report={issuer}
            contractMatches={contractMatches}
            onChooseReceipt={() => document.getElementById('receipt-json')?.click()}
            t={t}
          />
          <input
            id="receipt-json"
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              void loadReceipt(files);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
