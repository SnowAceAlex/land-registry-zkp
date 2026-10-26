'use client';

import { useQueries } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { apiFailure } from '../../api/error-message';
import { useChangeSets } from '../../api/hooks';
import type { wagmiConfig } from '../../wallet/wallet-config';

type ConfiguredChainId = (typeof wagmiConfig)['chains'][number]['id'];

const LIMIT = 10;

export function RecentRounds({
  chainId,
  lang,
  t,
  errors,
}: {
  chainId: number;
  lang: Locale;
  t: Dictionary['govOperations'];
  errors: Dictionary['govErrors'];
}) {
  const changeSets = useChangeSets();
  const client = usePublicClient({ chainId: chainId as ConfiguredChainId });

  const rounds = (changeSets.data ?? [])
    .filter((c) => c.status === 'PUBLISHED')
    .sort((a, b) => b.id - a.id)
    .slice(0, LIMIT);

  // Display only (D43): a receipt we cannot read costs a dash, never a decision.
  const gas = useQueries({
    queries: rounds.map((round) => ({
      queryKey: ['gov', 'round-gas', chainId, round.txHash] as const,
      queryFn: async () =>
        (await client!.getTransactionReceipt({ hash: round.txHash as `0x${string}` })).gasUsed,
      enabled: Boolean(client && round.txHash),
      staleTime: Infinity,
      retry: false,
    })),
  });
  const numbers = new Intl.NumberFormat(lang);

  return (
    <section aria-labelledby="ops-rounds" className="space-y-3">
      <h2 id="ops-rounds" className="font-medium text-ink">{t.roundsTitle}</h2>

      {changeSets.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : changeSets.error ? (
        <Notice tone="danger" title={apiFailure(changeSets.error, errors).title} />
      ) : rounds.length === 0 ? (
        <p className="text-sm text-steel">{t.roundsEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t.colRound}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colPublished}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.colContents}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colFiles}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colGas}</th>
                <th scope="col" className="px-4 py-2 font-medium">{t.lastTransaction}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              {rounds.map((round, i) => {
                const used = gas[i]?.data;
                return (
                  <tr key={round.id}>
                    <td className="px-4 py-2 font-mono text-xs">
                      #{round.id}
                      {round.rootVersion !== null ? ` · v${round.rootVersion}` : ''}
                    </td>
                    <td className="px-4 py-2 text-xs text-steel">
                      {round.publishedAt ? new Date(round.publishedAt).toLocaleString(lang) : t.noValue}
                    </td>
                    <td className="px-4 py-2">
                      {format(t.contents, {
                        issuance: numbers.format(round.issuanceCount),
                        transfer: numbers.format(round.transferCount),
                        revocation: numbers.format(round.revocationCount),
                      })}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {round.archiveCount === 0
                        ? t.noValue
                        : `${round.archivesDownloaded}/${round.archiveCount}`}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {used !== undefined ? numbers.format(used) : t.noValue}
                    </td>
                    <td className="px-4 py-2">
                      {round.txHash ? <HashText value={round.txHash} /> : t.noValue}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
