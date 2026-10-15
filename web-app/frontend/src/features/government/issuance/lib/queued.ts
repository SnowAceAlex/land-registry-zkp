/** Plots that already have an open (READY) issuance request; they stay IMPORTED until the round. */
export function queuedPropertyIds(
  requests: readonly { propertyId: string; status: string }[] | undefined,
): Set<string> {
  return new Set(
    (requests ?? []).filter((r) => r.status === 'READY').map((r) => r.propertyId),
  );
}

/** The picked ids that may still be requested. */
export function requestablePicks(picked: ReadonlySet<string>, queued: ReadonlySet<string>): string[] {
  return [...picked].filter((id) => !queued.has(id));
}
