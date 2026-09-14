/**
 * i18n/config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Locale identity. Deliberately free of `server-only` and of any import that
 * reaches for `fs`: proxy.ts, Client Components and Server Components all read
 * from here, so it has to stay portable across every runtime.
 *
 * Vietnamese is the default because the users are Vietnamese: commune-level
 * officers at the counter, and residents looking up their own parcel. English
 * exists alongside it for the thesis committee and for the code's own docs.
 */

export const LOCALES = ['vi', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'vi';

/** Remembers the reader's choice across visits. Read by proxy.ts. */
export const LOCALE_COOKIE = 'land-registry.locale';

/** One year. A language preference is not a session-scoped thing. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** For the `lang` attribute and `Intl` formatting, which want a BCP 47 tag. */
export const BCP47: Record<Locale, string> = {
  vi: 'vi-VN',
  en: 'en-US',
};

export const LOCALE_LABEL: Record<Locale, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
};

/**
 * Pick a locale from an Accept-Language header.
 *
 * Hand-written rather than pulling in negotiator + @formatjs/intl-localematcher
 * as the Next guide suggests: with exactly two locales the matching rules those
 * libraries exist to handle (region fallback chains, wildcard ranking across
 * dozens of tags) do not arise, and this runs in the proxy on every request.
 *
 * Handles quality values, so `en;q=0.4,vi;q=0.9` picks vi rather than trusting
 * source order, and matches on the primary subtag so `vi-VN` and `en-GB` land
 * where they should. Returns null when nothing matches, leaving the decision to
 * the caller rather than silently guessing.
 */
export function matchLocale(acceptLanguage: string | null): Locale | null {
  if (!acceptLanguage) return null;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return {
        // `vi-VN` -> `vi`. The wildcard `*` never matches a concrete locale.
        primary: tag.trim().toLowerCase().split('-')[0],
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    // q=0 means "explicitly not acceptable", so it must be dropped, not sorted last.
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { primary } of ranked) {
    if (isLocale(primary)) return primary;
  }
  return null;
}
