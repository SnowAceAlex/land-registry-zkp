/**
 * features/government/import/api.ts - UC-2 backend calls.
 *
 * Two steps (D52): a dry run that validates every row and writes nothing, then
 * the real import. The commit sends the same file again and the backend
 * re-validates it from scratch — nothing from the dry run is trusted.
 */

import { govPostForm } from '../api/gov-client';
import type { ImportResult } from '../api/types';

function formWith(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

/** POST /government/import?dryRun=true — per-row verdict, no writes. */
export function previewImport(file: File): Promise<ImportResult> {
  return govPostForm<ImportResult>('/government/import?dryRun=true', formWith(file));
}

/** POST /government/import — writes the valid rows as IMPORTED. */
export function commitImport(file: File): Promise<ImportResult> {
  return govPostForm<ImportResult>('/government/import', formWith(file));
}
