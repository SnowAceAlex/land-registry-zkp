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
 * TODO:
 *  1. Government routes need the x-gov-api-key header from
 *     features/government/auth/lib/gov-session.ts. Add a govFetch() here that
 *     takes the key as an argument, rather than having this file read
 *     sessionStorage and couple the transport to one portal.
 *  2. Map the backend's typed rejections (D33: InvalidProof / RootMismatch /
 *     StaleTimestamp, carried in a 422 body as `reason`) to a typed error
 *     instead of the generic Error below.
 */

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

/**
 * Must stay identical to GOV_API_KEY_HEADER in
 * web-app/backend/src/common/api-key.guard.ts. Duplicated rather than imported
 * because the backend is not a workspace dependency of the frontend; a mismatch
 * shows up as a blanket 401 on every government route.
 */
export const GOV_API_KEY_HEADER = 'x-gov-api-key';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
