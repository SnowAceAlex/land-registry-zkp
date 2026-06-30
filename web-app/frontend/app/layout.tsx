/**
 * app/layout.tsx — Root Layout
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO: Add WagmiProvider + RainbowKitProvider + QueryClientProvider here.
 *
 * Steps:
 *  1. Mark this file as 'use client' if you wrap providers here
 *     (or create a separate app/providers.tsx 'use client' component)
 *  2. Import wagmiConfig from '@/lib/wallet'
 *  3. Import '@rainbow-me/rainbowkit/styles.css' for default styles
 *  4. Wrap {children} with:
 *     <WagmiProvider config={wagmiConfig}>
 *       <QueryClientProvider client={queryClient}>
 *         <RainbowKitProvider>
 *           {children}
 *         </RainbowKitProvider>
 *       </QueryClientProvider>
 *     </WagmiProvider>
 *
 * See: https://www.rainbowkit.com/docs/installation#wrap-providers
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Land Registry ZKP",
  description:
    "Privacy-preserving Land Use Rights registry using Merkle tree + Zero-Knowledge Proofs on Ethereum",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        TODO: Replace <body> contents with provider-wrapped version (see file header).
        Create app/providers.tsx as a 'use client' component containing all providers,
        then import and use <Providers>{children}</Providers> here.
      */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

