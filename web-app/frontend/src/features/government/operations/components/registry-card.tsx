import Link from 'next/link';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { HashText } from '@/components/ui/hash-text';

import type { Overview } from '../../api/types';

export function RegistryCard({
  overview,
  isCentral,
  lang,
  t,
}: {
  overview: Overview;
  isCentral: boolean;
  lang: Locale;
  t: Dictionary['govOperations'];
}) {
  const { registry, openDraft } = overview;
  const dash = t.noValue;

  return (
    <section aria-labelledby="ops-registry" className="space-y-3">
      <h2 id="ops-registry" className="font-medium text-ink">{t.registryTitle}</h2>
      <dl className="grid gap-x-8 gap-y-4 rounded-lg border border-hairline bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t.rootVersion}>
          <span className="font-mono">
            {registry.onChainVersion > 0
              ? format(t.rootVersionValue, { version: registry.onChainVersion })
              : t.noRoot}
          </span>
        </Fact>
        <Fact label={t.lastPublished}>
          {registry.lastPublishedAt ? new Date(registry.lastPublishedAt).toLocaleString(lang) : dash}
        </Fact>
        <Fact label={t.lastTransaction}>
          {registry.lastTxHash ? <HashText value={registry.lastTxHash} /> : dash}
        </Fact>
        <Fact label={t.chainAndDatabase}>
          {registry.inSync
            ? t.inSync
            : format(t.outOfSync, {
                chain: registry.onChainVersion,
                db: registry.dbVersion ?? dash,
              })}
        </Fact>
        <Fact label={t.openDraft}>
          {openDraft ? (
            <span className="flex flex-wrap items-center gap-x-3">
              {format(t.draftValue, { id: openDraft.id })}
              {isCentral ? (
                <Link
                  href={`/${lang}/government/changes`}
                  className="font-medium text-authority underline underline-offset-4"
                >
                  {t.goToClose}
                </Link>
              ) : null}
            </span>
          ) : (
            t.noDraft
          )}
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-steel">{label}</dt>
      <dd className="mt-1 text-ink">{children}</dd>
    </div>
  );
}
