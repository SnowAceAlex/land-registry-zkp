/**
 * i18n/format.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fill `{placeholder}` slots in a dictionary string.
 *
 * Its own file, not part of dictionaries.ts, because that file is `server-only`
 * and Client Components need this too (the government gate formats an error
 * detail). Kept deliberately small: a full ICU message formatter would be a
 * dependency serving a single call site.
 */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
