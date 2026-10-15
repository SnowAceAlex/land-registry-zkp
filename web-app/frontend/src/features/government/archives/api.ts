/** Backend calls of the archives page (D88). */

import { govDownload } from '../api/gov-client';

/** Streams one office's archive of a round to the browser; resolves to its filename. */
export function downloadArchive(changeSetId: number, officeCode: string): Promise<string> {
  return govDownload(
    `/government/changesets/${changeSetId}/archives/${encodeURIComponent(officeCode)}`,
  );
}
