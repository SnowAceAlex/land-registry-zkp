/**
 * lib/gov-session.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The GOV_API_KEY half of the government portal's auth (D49).
 *
 * Two separate things authorise a government action and they are easy to
 * conflate: this key authenticates the *portal* to the backend, while Metamask
 * authorises the *chain write* (D43). Neither substitutes for the other.
 *
 * sessionStorage, not localStorage, on purpose: the key dies with the tab, so a
 * shared counter machine does not leave an officer signed in for the next
 * person. It is read-only from JS on the same origin either way, which is the
 * honest limitation to state in the thesis rather than gloss.
 */

import { GOV_API_KEY_HEADER } from './api';

const STORAGE_KEY = 'land-registry.gov-api-key';

export function readGovKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled. Treat as signed out rather than crashing.
    return null;
  }
}

export function writeGovKey(key: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* ignore - the caller keeps the key in memory for this page view */
  }
}

export function clearGovKey(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Ask the backend whether a key is real. `GET /api/government/status` is behind
 * ApiKeyGuard, so a 200 proves the key, and a 401 disproves it. Anything else
 * is a transport problem and must not be reported to the officer as "wrong
 * key" - that sends them hunting for a credential that was fine all along.
 */
export async function validateGovKey(
  key: string,
): Promise<{ ok: true } | { ok: false; reason: 'rejected' | 'unreachable'; detail?: string }> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
  let res: Response;
  try {
    res = await fetch(`${base}/api/government/status`, {
      headers: { [GOV_API_KEY_HEADER]: key },
      cache: 'no-store',
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected' };
  if (!res.ok) {
    return { ok: false, reason: 'unreachable', detail: `${res.status} ${res.statusText}` };
  }
  return { ok: true };
}
