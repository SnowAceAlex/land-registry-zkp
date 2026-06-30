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
    return config;
  },
};

export default nextConfig;

