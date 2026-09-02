/**
 * scripts/lib/http.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal JSON client for scripts that drive the backend API.
 *
 * Kept deliberately thin: these scripts exercise the API the way an external
 * caller would, so wrapping it in anything smarter than "send JSON, read JSON,
 * report the status" would test the wrapper instead of the endpoint.
 */

const DEFAULT_API_BASE = 'http://localhost:3001/api';

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export function apiBase(): string {
  return process.env.API_BASE ?? DEFAULT_API_BASE;
}

/**
 * POST JSON and parse the response.
 *
 * A non-JSON body is returned as the raw text rather than throwing: error
 * responses from proxies and crashes are usually HTML, and seeing that text is
 * how you find out what actually went wrong.
 *
 * @param apiKey sent as `x-gov-api-key` (D14) when the endpoint is guarded
 */
export async function postJson<T = unknown>(
  endpoint: string,
  body: unknown,
  apiKey?: string,
): Promise<ApiResponse<T>> {
  return request<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }, apiKey);
}

/**
 * GET and parse the response.
 *
 * `apiKey` is optional here for a reason worth stating: the proof endpoints are
 * deliberately unguarded (D39) — the caller is a land owner or a buyer, not an
 * officer — so the owner-side scripts pass nothing.
 */
export async function getJson<T = unknown>(
  endpoint: string,
  apiKey?: string,
): Promise<ApiResponse<T>> {
  return request<T>(endpoint, { method: 'GET' }, apiKey);
}

async function request<T>(
  endpoint: string,
  init: RequestInit,
  apiKey?: string,
): Promise<ApiResponse<T>> {
  const response = await fetch(`${apiBase()}${endpoint}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-gov-api-key': apiKey } : {}),
    },
  });

  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as T };
  } catch {
    return { status: response.status, body: text as T };
  }
}

/** Print the failing response and exit — the scripts have nothing useful to do after. */
export function abort(step: string, result: ApiResponse): never {
  console.error(`\n${step} failed (HTTP ${result.status}):`);
  console.error(JSON.stringify(result.body, null, 2));
  process.exit(1);
}
