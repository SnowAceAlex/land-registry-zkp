/**
 * app/[lang]/layout.tsx - Root Layout
 *
 * The root layout lives under [lang] because <html lang> has to carry the
 * actual locale, and that is only known from the route params.
 *
 * Deliberately provider-free. The wallet stack (wagmi + RainbowKit +
 * WalletConnect) is mounted in government/layout.tsx instead, because only the
 * government portal signs transactions (D43). See components/providers.tsx.
 * 
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Be_Vietnam_Pro, Geist_Mono } from 'next/font/google';

import { BCP47, LOCALES, isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import '../globals.css';

const sans = Be_Vietnam_Pro({
  variable: '--font-sans-face',
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const mono = Geist_Mono({
  variable: '--font-mono-face',
  subsets: ['latin'],
  display: 'swap',
});

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.metadata.title,
    description: dict.metadata.description,
  };
}

export default async function RootLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;

  if (!isLocale(lang)) notFound();

  return (
    <html
      lang={BCP47[lang]}
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
