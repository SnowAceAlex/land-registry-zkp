import 'server-only';

import type { Locale } from './config';
import type en from './dictionaries/en.json';
import type vi from './dictionaries/vi.json';

/**
 * i18n/dictionaries.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side dictionary loader.
 *
 * `server-only` is the point of this file, not decoration. Because every page
 * and layout is a Server Component, the dictionaries are read on the server and
 * only the resulting HTML reaches the browser, so adding a third language costs
 * the client nothing. The import guard is what stops someone from casually
 * importing a dictionary into a Client Component and quietly undoing that.
 *
 * Client Components get the slice they need passed down as props from their
 * server layout. See features/government/shell/components/government-nav.tsx
 * for the shape.
 */

/** English is the source of truth: new strings get written here first. */
export type Dictionary = typeof en;

/**
 * Compile-time parity between the two files.
 *
 * A key added to en.json and forgotten in vi.json is the failure mode that
 * actually happens, and it would otherwise surface as `undefined` rendered into
 * a page. Bidirectional so an orphaned key left behind in vi.json is caught
 * too. This is a type error in `tsc`, which `next build` runs, so it fails the
 * build rather than the page.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type DictionaryParity = Assert<Exact<Dictionary, typeof vi>>;

const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  en: () => import('./dictionaries/en.json').then((m) => m.default),
  vi: () => import('./dictionaries/vi.json').then((m) => m.default),
};

export const getDictionary = async (locale: Locale): Promise<Dictionary> => dictionaries[locale]();

/* `format()` lives in ./format.ts: Client Components need it, and this file is server-only. */
