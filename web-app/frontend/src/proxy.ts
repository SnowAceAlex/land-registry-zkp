import { NextResponse, type NextRequest } from 'next/server';

import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  matchLocale,
} from '@/i18n/config';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (hasLocale) {
    const current = pathname.split('/')[1];
    if (isLocale(current) && request.cookies.get(LOCALE_COOKIE)?.value !== current) {
      const response = NextResponse.next();
      response.cookies.set(LOCALE_COOKIE, current, {
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
        path: '/',
      });
      return response;
    }
    return NextResponse.next();
  }

  const stored = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale =
    (stored && isLocale(stored) ? stored : null) ??
    matchLocale(request.headers.get('accept-language')) ??
    DEFAULT_LOCALE;

  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|.*\\.).*)'],
};
