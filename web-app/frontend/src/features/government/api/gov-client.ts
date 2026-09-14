/**
 * features/government/api/gov-client.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The government portal's calls to the backend: lib/api-client's transport with
 * the portal key from this tab's session attached.
 *
 * A 401 means the key was rotated or revoked since sign-in. The only useful
 * response is to drop it and show the gate again — keeping a dead key would
 * make every screen fail with the same error forever.
 */

import { ApiError, govFetch, govFetchBlob } from '@/lib/api-client';
import { downloadBlob } from '@/lib/download';

import { clearGovKey, readGovKey } from '../auth/lib/gov-session';

async function withKey<T>(run: (key: string) => Promise<T>): Promise<T> {
  const key = readGovKey();
  if (!key) {
    window.location.reload();
    throw new ApiError(401, 'The portal key is missing from this tab');
  }
  try {
    return await run(key);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearGovKey();
      window.location.reload();
    }
    throw error;
  }
}

export function govGet<T>(path: string): Promise<T> {
  return withKey((key) => govFetch<T>(key, path));
}

export function govPost<T>(path: string, body?: unknown): Promise<T> {
  return withKey((key) =>
    govFetch<T>(key, path, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  );
}

export function govPostForm<T>(path: string, form: FormData): Promise<T> {
  return withKey((key) => govFetch<T>(key, path, { method: 'POST', body: form }));
}

export function govDelete<T>(path: string): Promise<T> {
  return withKey((key) => govFetch<T>(key, path, { method: 'DELETE' }));
}

/** Fetch a guarded file and hand it to the browser. Resolves to its filename. */
export function govDownload(path: string): Promise<string> {
  return withKey(async (key) => {
    const { blob, filename } = await govFetchBlob(key, path);
    downloadBlob(blob, filename);
    return filename;
  });
}
