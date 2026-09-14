import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from '@/i18n/config';

/**
 * lib/locale-cookie.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Writes the locale preference from the browser.
 *
 * Separate from i18n/config.ts because that file is imported by proxy.ts, which
 * runs server-side and may be deployed to a CDN, where `document` does not
 * exist. Separate from the switcher component because writing to `document`
 * inside a component body is exactly what the React Compiler's immutability
 * rule is there to catch.
 *
 * The proxy also sets this cookie, but only on a request it actually sees. A
 * client-side navigation produces no such request, so the switcher has to write
 * it here or the choice would not survive a reload.
 */
export function persistLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}
