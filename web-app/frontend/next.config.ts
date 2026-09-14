import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the pnpm workspace package so Next.js can handle its TypeScript source
  transpilePackages: ["@land-registry/blockchain"],

  // snarkjs uses WASM — exclude it from server-side bundle (run client-side only)
  serverExternalPackages: ["snarkjs"],

  webpack: (config) => {
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

    // pino (via @walletconnect/logger) requires pino-pretty only when configured
    // to pretty-print; lokijs/encoding are the same kind of optional import.
    config.externals.push("pino-pretty", "lokijs", "encoding");

    return config;
  },
};

export default nextConfig;
