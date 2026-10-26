'use client';

/**
 * UC-2 interaction: choose a CSV → dry run → review → import the valid rows.
 *
 * Why the dry run is not optional here (D52): an IMPORTED row cannot be edited
 * or deleted through the API, and a row can be valid yet wrong (a mistyped
 * area passes every rule). The officer sees the verdict on the whole file
 * before anything is written, and the commit re-sends the same file so the
 * backend validates it again rather than trusting this screen.
 */

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp, LoaderCircle } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';

import { type Failure, apiFailure } from '../../api/error-message';
import type { ImportResult } from '../../api/types';
import { commitImport, previewImport } from '../api';
import { ImportReport } from './import-report';

type State =
  | { phase: 'idle' }
  | { phase: 'checking'; file: File }
  | { phase: 'previewed'; file: File; result: ImportResult }
  | { phase: 'committing'; file: File; result: ImportResult }
  | { phase: 'committed'; result: ImportResult }
  | { phase: 'failed'; failure: Failure };

export function ImportWorkbench({
  lang,
  t,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govImport'];
  errors: Dictionary['govErrors'];
}) {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  async function check(files: FileList | null) {
    const file = files?.[0];
    if (!files || files.length !== 1 || !file || !file.name.toLowerCase().endsWith('.csv')) {
      setState({ phase: 'failed', failure: { title: t.onlyCsv } });
      return;
    }
    setState({ phase: 'checking', file });
    try {
      setState({ phase: 'previewed', file, result: await previewImport(file) });
    } catch (error) {
      setState({ phase: 'failed', failure: apiFailure(error, errors) });
    }
  }

  async function commit() {
    if (state.phase !== 'previewed') return;
    setState({ ...state, phase: 'committing' });
    try {
      const result = await commitImport(state.file);
      await queryClient.invalidateQueries({ queryKey: ['gov', 'properties'] });
      setState({ phase: 'committed', result });
    } catch (error) {
      setState({ phase: 'failed', failure: apiFailure(error, errors) });
    }
  }

  function reset() {
    if (inputRef.current) inputRef.current.value = '';
    setState({ phase: 'idle' });
  }

  if (state.phase === 'committed') {
    return (
      <div className="space-y-6">
        <Notice
          tone="success"
          title={format(t.committedTitle, { count: state.result.imported })}
        >
          {format(t.committedBody, { skipped: state.result.skipped })}
        </Notice>
        <ImportReport result={state.result} t={t} />
        <div className="flex flex-wrap gap-3">
          <Link href={`/${lang}/government/issuance`} className={buttonStyles.primary}>
            {t.goToIssuance}
          </Link>
          <button type="button" className={buttonStyles.secondary} onClick={reset}>
            {t.importAnother}
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'previewed' || state.phase === 'committing') {
    const committing = state.phase === 'committing';
    return (
      <div className="space-y-6">
        <h2 className="font-medium text-ink">{format(t.checkedTitle, { name: state.file.name })}</h2>
        <ImportReport result={state.result} t={t} />
        <div className="flex flex-col gap-3 border-t border-whisper pt-5 sm:flex-row sm:items-center">
          {state.result.imported > 0 ? (
            <button type="button" className={buttonStyles.primary} disabled={committing} onClick={commit}>
              {committing ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  {t.committing}
                </>
              ) : (
                format(t.commit, { count: state.result.imported })
              )}
            </button>
          ) : (
            <p className="text-sm text-steel">{t.noValidRows}</p>
          )}
          <button type="button" className={buttonStyles.secondary} disabled={committing} onClick={reset}>
            {t.chooseAnother}
          </button>
        </div>
      </div>
    );
  }

  const checking = state.phase === 'checking';
  return (
    <div className="space-y-4">
      <label
        htmlFor="import-csv"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void check(event.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center ui-transition ${
          dragging ? 'border-authority bg-zinc-50' : 'border-hairline bg-white hover:border-zinc-300'
        }`}
      >
        <span className="rounded-full border border-hairline bg-zinc-50 p-3.5">
          {checking ? (
            <LoaderCircle className="h-5 w-5 animate-spin text-steel" aria-hidden />
          ) : (
            <FileUp className="h-5 w-5 text-steel" strokeWidth={1.5} aria-hidden />
          )}
        </span>
        <span className="mt-5 font-medium text-ink">
          {checking ? format(t.checking, { name: state.file.name }) : t.chooseFile}
        </span>
        {!checking ? <span className="mt-1 text-sm text-steel">{t.dropHint}</span> : null}
        <span className="mt-3 max-w-[46ch] text-sm leading-relaxed text-steel">{t.emptyBody}</span>
        <input
          ref={inputRef}
          id="import-csv"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={checking}
          aria-describedby={state.phase === 'failed' ? 'import-csv-error' : undefined}
          onChange={(event) => void check(event.target.files)}
        />
      </label>

      {state.phase === 'failed' ? (
        <div id="import-csv-error">
          <Notice tone="danger" title={state.failure.title}>
            {state.failure.detail}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}
