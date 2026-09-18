# @land-registry/frontend

Next.js 16 App Router frontend for the Land Use Rights registry: a landing page and two
portals, Government and Resident (D49). Read `AGENTS.md` before writing code — this
Next.js version postdates most training data — and `DESIGN.md` before touching UI.

```bash
pnpm run dev:frontend                    # from the repo root, port 3000 (--webpack)
pnpm --filter frontend run build
pnpm --filter frontend run lint          # also enforces the feature boundaries below
pnpm --filter frontend run test          # Vitest — pure logic only, node environment (D57)
```

Before `dev`/`build`, two generated inputs must exist (both gitignored):

- `pnpm run compile` — the portal takes RootRegistry's ABI from the compiler artifact
  (`blockchain/artifacts/…/RootRegistry.json`), typed by typechain's const ABI.
- `pnpm --filter blockchain run circuits:setup` (or `circuits:sync-frontend` to re-copy) —
  the browser proves with `public/circuits/<circuit>/{<circuit>.wasm, .zkey, verification_key.json}`
  (D55). A missing copy shows up as a 404 inside the proving worker.

## Project structure

Feature-based, inside `src/`. Config files and `public/` stay at the package root.

```text
src/
├── proxy.ts                         locale redirect (Next 16's renamed middleware)
├── app/                             ROUTING ONLY — thin page.tsx / layout.tsx
│   ├── globals.css                  design tokens + motion utilities (DESIGN.md)
│   └── [lang]/
│       ├── layout.tsx               <html lang>, fonts, metadata
│       ├── page.tsx                 → features/landing
│       ├── government/              layout mounts wallet + API-key gate + nav
│       │   └── import | issuance | transfers | changes /page.tsx
│       └── resident/                layout mounts nav, no wallet
│           └── lookup | proof | verify /page.tsx
├── features/
│   ├── landing/components/          landing-view.tsx
│   ├── government/
│   │   ├── auth/                    portal infra: GOV_API_KEY gate + session storage
│   │   ├── api/                     portal infra: key-aware client, response types, shared queries, error codes
│   │   ├── publishing/              portal infra: nextDraftStep + DraftPanel (sign → mine → confirm, D43/D53)
│   │   ├── shell/                   portal infra: nav + registry status bar (chain, root, open draft, wallet)
│   │   ├── wallet/                  portal infra: wagmi config, RootRegistry ABI/codec, chain reads + publish
│   │   ├── import/                  UC-2   dry run → import (D52)
│   │   ├── issuance/                UC-1   pick → draft → sign → confirm → archive
│   │   ├── transfers/               UC-3   transfer counter (client-side proof) + approval queue
│   │   └── changes/                 UC-4   change sets + revocation requests
│   └── resident/                    logged-out, no wallet, no provider (D61)
│       ├── shell/                   portal infra: nav, /public/config cache + hook, error wording
│       ├── lookup/                  D48    public property history
│       ├── proof/                   UC-5   client-side proof generation
│       └── verify/                  UC-6   four ordered checks + D30 issuer chain + revocation
├── components/ui/                   design-system primitives (button, empty-state, page-header, notice, skeleton, hash-text)
├── i18n/                            locales, server-only dictionaries, format, locale switcher
└── lib/                             cross-portal infra (D66): api-client (transport + ApiError), api-error-code,
                                     bundle (receipt + secret reader), proof-file (proof.json reader), disclosure
                                     (what a proof reveals / never reveals), contracts (both ABIs + root codec),
                                     chain-config (/public/config + RPC choice + viem client), registry-reads,
                                     revocation-reason, term, download, zkp + zkp.worker (prove AND verify in a worker)
```

### Inside a feature

```text
features/<portal>/<feature>/
├── components/     <feature>-view.tsx is the screen; sub-components sit beside it
├── hooks/          client hooks, when the feature needs them
├── lib/            pure helpers owned by this feature (tests sit beside them: *.test.ts)
└── api.ts          this feature's backend calls, built on lib/api-client.ts
```

Government use cases call the backend through `features/government/api/gov-client.ts` (it adds
the portal key and returns to the gate on a 401); resident features call `apiFetch` directly,
because every route they touch is public by design (D39/D48/D50). Screens branch on
`apiErrorCode()` / `residentErrorCode()` / `walletErrorCode()` and show the backend's text only
as the detail line — never on message text.

Anything two sibling features need is **promoted**, never reached for sideways (D66): code to
`src/lib/`, and shared STRINGS as an extra dictionary slice passed from `page.tsx`
(`residentSignals`, `residentRevocation`) — through the route, not through an import.

### Browser bundling notes (learned the hard way)

- `blockchain/shared` must stay free of `node:` specifiers and static `fs`/`crypto` imports —
  `blockchain/test/shared/browserSafety.test.ts` fails the blockchain suite otherwise.
- `next.config.ts` aliases `crypto` to `false` for the client build. A `resolve.fallback` entry
  does not work: Next 16 sets its Node polyfills as a module-rule-level fallback that overrides it,
  and the barrel would pull ~325 KB of crypto-browserify for code the browser never runs.
- Import proving code (`lib/zkp.ts`) with types only from the shared barrel; snarkjs and
  circomlibjs belong in the worker chunk. The `web-worker` "Critical dependency" build warning
  comes from ffjavascript inside circomlibjs and is expected.
- **Import shared VALUES by subpath, not through the barrel** (D67). The barrel re-exports
  `merkleTree.ts` (circomlibjs) and `zkpHelper.ts` (snarkjs), so importing one constant costs
  ~3 MB: `/resident/lookup` was 3.7 MB before this was measured, for the sake of
  `MAX_PROPERTY_ID`. Use `@land-registry/blockchain/shared/{treeDimensions,leafFields,`
  `solidityCalldata,circuitInputs,datetime,types,receipt}`. `import type` from the barrel is
  fine — it is erased before the bundler sees it.
- Load a heavy module at the moment it is needed, not at page load. `/resident/proof` imports
  `bundle-integrity.ts` dynamically (it is the only hashing on that page: 4071 → 872 kB), and
  `/resident/verify` imports `@peculiar/x509` dynamically (194 kB, only once a receipt is
  supplied). ⚠️ `reflect-metadata` must be imported **before** `@peculiar/x509`, which builds
  on tsyringe and throws at module init without it — `next build` does not catch this, because
  the failure is at runtime.
- Measure, do not assume. `next build`, then read the chunk list out of
  `.next/server/app/en/<route>.html`: resident routes must carry **zero** wagmi/RainbowKit
  chunks. Beware a naive grep for `walletconnect` — viem defines its own
  `WalletConnectSessionSettlementError` and will match.

Only create a folder once it has a file. Each view's header comment records what the screen
does and why — in Phases 8–9 these replaced the original TODO specs as the screens landed.
Keep them; they are where the reasoning lives.

### Rules

1. **`app/` only routes.** A page validates `lang`, loads its dictionary slice and renders
   one feature view. No UI, state or fetching logic in `app/`.
2. **Dependencies point one way:** `app → features → components / i18n / lib`. Shared code
   never imports a feature or a route.
3. **Use-case features don't import each other.** They may use their portal's
   infrastructure (`government/{auth,shell,wallet}`, `resident/shell`). Anything two use
   cases need is promoted: within a portal to a new infra folder, across portals to
   `components/` or `lib/`.
4. **The portals never import each other.** This is what keeps the ~665 KB wallet stack
   off the logged-out resident pages (DESIGN.md §10, D39/D49).
5. **Server Components by default.** A `'use client'` component receives its strings as
   props; `i18n/dictionaries.ts` is `server-only` and must not reach the client bundle.
6. **No barrel `index.ts` files.** Import the file directly. A barrel would drag every
   module of a feature (snarkjs, wagmi) into any page that imports one symbol from it.
7. **Names:** files `kebab-case.tsx`, components `PascalCase`, one exported component per
   file.
8. **Crypto stays in `blockchain/shared`.** Merkle/Poseidon logic, circuit inputs and the
   receipt format are imported from `@land-registry/blockchain/shared`, never re-implemented
   here (repo-wide design rule).

Rules 2–4 are enforced by `import/no-restricted-paths` in `eslint.config.mjs`. When you add
a use-case feature, add it to `PORTAL_FEATURES` there too.
