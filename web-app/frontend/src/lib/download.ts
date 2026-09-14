/**
 * lib/download.ts - hand a file the page built (or fetched) to the browser.
 *
 * Everything stays in memory: the object URL is revoked right after the click,
 * which matters for the one file here that must not linger — the buyer's
 * secret.json at the transfer counter (D51).
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadBlob(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    filename,
  );
}
