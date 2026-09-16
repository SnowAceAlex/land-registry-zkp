import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the pnpm workspace package so Next.js can handle its TypeScript source
  transpilePackages: ["@land-registry/blockchain"],

  // snarkjs uses WASM — exclude it from server-side bundle (run client-side only)
  serverExternalPackages: ["snarkjs"],

  webpack: (config, { isServer }) => {
    // Required for snarkjs / circomlibjs WASM files
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      // Optional deps of the wallet stack that never run in a browser:
      // @metamask/sdk imports React Native storage for its RN build only.
      "@react-native-async-storage/async-storage": false,
    };

    if (!isServer) {
      // blockchain/shared loads `crypto` lazily for its Node-only paths (the
      // sync offchain digest, X.509 signing). The browser never calls those —
      // it uses receiptToLURRecordAsync / WebCrypto — yet webpack still bundled
      // Next's crypto-browserify (~325 KB) for the require. An alias, not a
      // `resolve.fallback` entry: Next 16 sets its browser polyfills as a
      // module-rule-level fallback, which overrides a top-level one silently.
      config.resolve.alias = { ...config.resolve.alias, crypto: false };
    }

    // pino (via @walletconnect/logger) requires pino-pretty only when configured
    // to pretty-print; lokijs/encoding are the same kind of optional import.
    config.externals.push("pino-pretty", "lokijs", "encoding");

    return config;
  },
};

export default nextConfig;
