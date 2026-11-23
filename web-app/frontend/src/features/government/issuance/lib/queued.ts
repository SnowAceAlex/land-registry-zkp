/** Plots that already have an open (READY) issuance request; they stay IMPORTED until the round. */
export function queuedPropertyIds(
  requests: readonly { propertyId: string; status: string }[] | undefined,
): Set<string> {
  return new Set(
    (requests ?? []).filter((r) => r.status === 'READY').map((r) => r.propertyId),
  );
}

/** Requests grouped by the plot's branch (CN01 first, unassigned last), each group by propertyId. */
export function groupByOffice<T extends { landOfficeCode: string | null; propertyId: string }>(
  requests: readonly T[],
): { officeCode: string | null; requests: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const request of requests) {
    groups.set(request.landOfficeCode, [...(groups.get(request.landOfficeCode) ?? []), request]);
  }
  return [...groups]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1))
    .map(([officeCode, list]) => ({
      officeCode,
      // propertyId is a string: compared as text, "10" would sort before "2".
      requests: list.sort((x, y) => {
        const diff = BigInt(x.propertyId) - BigInt(y.propertyId);
        return diff < 0n ? -1 : diff > 0n ? 1 : 0;
      }),
    }));
}

/** The picked ids that may still be requested. */
export function requestablePicks(picked: ReadonlySet<string>, queued: ReadonlySet<string>): string[] {
  return [...picked].filter((id) => !queued.has(id));
}
