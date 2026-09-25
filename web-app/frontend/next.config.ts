import fs from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

/**
 * The root CA the resident verifier pins (D78), read once at build time.
 *
 * Same location rule as `trustedRootPath()` in blockchain/shared/issuerIdentity.ts
 * (`TRUSTED_ROOT_CA_PATH`, else `<repo>/pki/root-ca.cert.pem`) — restated here
 * rather than imported because the config is loaded before the workspace
 * package is transpiled. The repo root is found by walking up to
 * pnpm-workspace.yaml, so it does not depend on which directory `next` ran in.
 * Missing file → empty string → link 1 is `not-verifiable`, and the build
 * still succeeds on a fresh checkout.
 */
function readTrustedRootPem(): string {
  const override = process.env.TRUSTED_ROOT_CA_PATH?.trim();
  let file = override ? path.resolve(override) : "";

  if (!file) {
    let dir = process.cwd();
    while (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      const parent = path.dirname(dir);
      if (parent === dir) return "";
      dir = parent;
    }
    file = path.join(dir, "pki", "root-ca.cert.pem");
  }

  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

const nextConfig: NextConfig = {
  // Transpile the pnpm workspace package so Next.js can handle its TypeScript source
  transpilePackages: ["@land-registry/blockchain"],

  // Inlined into the client bundle at build time — see src/features/resident/verify/lib/trusted-root.ts
  env: {
    TRUSTED_ROOT_CA_PEM: readTrustedRootPem(),
  },

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
