/**
 * lib/api-client.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Transport to the NestJS backend, shared by every feature.
 * Base URL: http://localhost:3001/api (configured via NEXT_PUBLIC_BACKEND_URL)
 *
 * Only the transport lives here. The endpoint functions belong to the feature
 * that calls them (features/<portal>/<feature>/api.ts), so a route's contract
 * sits next to the screen that depends on it.
 *
 * Government routes take the API key as an ARGUMENT rather than reading
 * sessionStorage here: this file is shared with the logged-out resident portal,
 * and coupling the transport to one portal's session would drag that portal's
 * auth into the other's bundle.
 */

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

/**
 * Must stay identical to GOV_API_KEY_HEADER in
 * web-app/backend/src/common/api-key.guard.ts. Duplicated rather than imported
 * because the backend is not a workspace dependency of the frontend; a mismatch
 * shows up as a blanket 401 on every government route.
 */
export const GOV_API_KEY_HEADER = 'x-gov-api-key';

/** The typed verifier rejections (D33), shared by the contract and the backend. */
export type ProofRejectionReason = 'InvalidProof' | 'RootMismatch' | 'StaleTimestamp';
const PROOF_REJECTION_REASONS: readonly string[] = ['InvalidProof', 'RootMismatch', 'StaleTimestamp'];

/**
 * A non-2xx response. `detail` is the backend's own explanation (English, kept
 * verbatim for the detail line); `reason` is set only for a D33 proof rejection,
 * which is what a screen branches on — never on the text.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly reason?: ProofRejectionReason,
    readonly details?: Record<string, string>,
  ) {
    super(`API ${status}: ${detail}`);
    this.name = 'ApiError';
  }
}

/**
 * Turn an error body into an ApiError. Handles the two shapes the backend
 * sends: Nest's `{ statusCode, message, error }` (message is a list for
 * class-validator failures) and a D33 rejection `{ reason, message, details }`.
 */
export function parseApiError(status: number, body: unknown, statusText = ''): ApiError {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = Array.isArray(record.message)
      ? record.message.map(String).join('; ')
      : typeof record.message === 'string'
        ? record.message
        : undefined;
    if (message !== undefined) {
      const reason =
        typeof record.reason === 'string' && PROOF_REJECTION_REASONS.includes(record.reason)
          ? (record.reason as ProofRejectionReason)
          : undefined;
      const details =
        record.details && typeof record.details === 'object'
          ? (record.details as Record<string, string>)
          : undefined;
      return new ApiError(status, message, reason, details);
    }
  }
  return new ApiError(status, `${status} ${statusText}`.trim());
}

/** `attachment; filename="batch-3.zip"` → `batch-3.zip`. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : fallback;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON — parseApiError falls back to the status line */
  }
  throw parseApiError(res.status, body, res.statusText);
}

function withJsonBody(init: RequestInit = {}): RequestInit {
  // FormData sets its own multipart boundary; forcing JSON would break it.
  if (init.body instanceof FormData) return init;
  return { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api${path}`, { cache: 'no-store', ...withJsonBody(init) });
  await throwIfNotOk(res);
  return res.json() as Promise<T>;
}

/** A government route: same transport, with the portal key attached. */
export async function govFetch<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...init, headers: { ...init.headers, [GOV_API_KEY_HEADER]: key } });
}

/**
 * A guarded file download. A plain `<a href>` cannot send the key header, so
 * the file is fetched here and handed to the caller as a Blob.
 */
export async function govFetchBlob(
  key: string,
  path: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    cache: 'no-store',
    headers: { [GOV_API_KEY_HEADER]: key },
  });
  await throwIfNotOk(res);
  const fallback = path.split('/').filter(Boolean).join('-') + '.zip';
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get('Content-Disposition'), fallback),
  };
}
