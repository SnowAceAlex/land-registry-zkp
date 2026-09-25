import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Feature boundaries (see README.md "Project structure").
 *
 * Dependencies point one way: app -> features -> shared (components, i18n, lib).
 * Inside a portal, use-case features may use the portal's infrastructure
 * (government: auth, shell, wallet; resident: shell) but never each other -
 * something two use cases need gets promoted, not reached for sideways.
 * The two portals never import each other: that is what keeps the wallet
 * stack off the logged-out resident pages (DESIGN.md section 10).
 */
const PORTAL_FEATURES = {
  government: ["import", "issuance", "transfers", "revocations", "changes"],
  resident: ["lookup", "proof", "verify"],
};

const siblingZones = Object.entries(PORTAL_FEATURES).flatMap(([portal, features]) =>
  features.map((feature) => ({
    target: `./src/features/${portal}/${feature}`,
    from: features
      .filter((other) => other !== feature)
      .map((other) => `./src/features/${portal}/${other}`),
    message: "Use-case features must not import each other. Promote shared code instead.",
  })),
);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          basePath: import.meta.dirname,
          zones: [
            {
              target: ["./src/components", "./src/i18n", "./src/lib"],
              from: ["./src/app", "./src/features"],
              message: "Shared code must not depend on routes or features.",
            },
            {
              target: "./src/features",
              from: "./src/app",
              message: "Features must not import from app/. Routes compose features, not the reverse.",
            },
            {
              target: "./src/features/resident",
              from: "./src/features/government",
              message: "The resident portal must not pull in government code (wallet bundle, API key).",
            },
            {
              target: "./src/features/government",
              from: "./src/features/resident",
              message: "Portals must not import each other. Promote shared code instead.",
            },
            {
              target: "./src/features/landing",
              from: ["./src/features/government", "./src/features/resident"],
              message: "The landing page must stay free of portal code.",
            },
            ...siblingZones,
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
