# @land-registry/frontend

Next.js 16 App Router frontend for the Land Use Rights registry: a landing page and two
portals, Government and Resident (D49). Read `AGENTS.md` before writing code — this
Next.js version postdates most training data — and `DESIGN.md` before touching UI.

```bash
pnpm run dev:frontend                    # from the repo root, port 3000 (--webpack)
pnpm --filter frontend run build
pnpm --filter frontend run lint          # also enforces the feature boundaries below
```

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
│   │   ├── shell/                   portal infra: sidebar / tab-bar nav
│   │   ├── wallet/                  portal infra: wagmi + RainbowKit config & providers
│   │   ├── import/                  UC-2   CSV bulk import
│   │   ├── issuance/                UC-1   draft → sign → confirm → archive
│   │   ├── transfers/               UC-3   transfer counter + approval queue
│   │   └── changes/                 UC-4   change sets + revocations
│   └── resident/
│       ├── shell/                   portal infra: header nav
│       ├── lookup/                  D48    public property history
│       ├── proof/                   UC-5   client-side proof generation
│       └── verify/                  UC-6   off-chain + on-chain verification
├── components/ui/                   design-system primitives (button, empty-state, page-header)
├── i18n/                            locales, server-only dictionaries, format, locale switcher
└── lib/                             cross-feature infra: api-client (transport), zkp (snarkjs)
```

### Inside a feature

```text
features/<portal>/<feature>/
├── components/     <feature>-view.tsx is the screen; sub-components sit beside it
├── hooks/          client hooks, when the feature needs them
├── lib/            pure helpers owned by this feature
└── api.ts          this feature's backend calls, built on lib/api-client.ts
```

Only create a folder once it has a file. The view's header comment is the feature's
implementation spec (the TODO list for Phase 8/9) — keep it when implementing, don't
delete it as dead code.

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
