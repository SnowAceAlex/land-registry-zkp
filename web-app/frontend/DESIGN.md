# Design System: Land Registry ZKP

## 1. Visual Theme & Atmosphere
A restrained, highly-trusted interface with confident asymmetric layouts and motion used only to confirm actions. The atmosphere is clinical yet warm, echoing a modern digital government portal or a high-end fintech platform. It balances the high-density requirements of a government dashboard with the accessible, gallery-airy feel needed for public residents.

- **Density:** 5 (Balanced — clean for residents, structured for government officers)
- **Variance:** 4 (Offset Asymmetric — breaking rigid 50/50 splits for more dynamic reading)
- **Motion:** 3 (Restrained CSS — 180ms scoped transitions; overshoot only where something travels)

## 2. Color Palette & Roles
- **Canvas White** (`#F9FAFB`) — Primary background surface for the entire application.
- **Pure Surface** (`#FFFFFF`) — Card and container fill.
- **Charcoal Ink** (`#18181B`) — Primary text, headings, and high-contrast data points.
- **Muted Steel** (`#71717A`) — Secondary text, descriptions, table headers, and metadata.
- **Whisper Border** (`rgba(226,232,240,0.5)`) — Card borders, 1px structural lines, table dividers.
- **Hairline** (`#E4E4E7`) — Opaque border for inputs and controls. Whisper is 50% alpha and vanishes against white, which fails contrast on form edges.
- **Authority Navy** (`#0F172A`) — Deep, saturated accent used for primary CTAs, active states, and focus rings. (Max 1 accent. No purple/neon).

## 3. Typography Rules
- **Display / Body:** `Be Vietnam Pro` — weights 400/500/600/700, subsets `latin`,
  `latin-ext`, `vietnamese`. Body at relaxed leading, 65ch max-width, neutral secondary
  color.
- **Mono:** `Geist Mono` — property IDs, Merkle roots, transaction hashes, root
  versions, UC tags. Everything it renders is ASCII, so its missing `vietnamese` subset
  does not matter.
- **Why not Geist for the sans:** Geist ships only `cyrillic`/`latin`/`latin-ext` on
  Google Fonts. Vietnamese precomposed glyphs live in Latin Extended Additional
  (U+1EA0-1EF9) plus U+01A0-01B0, which Google serves as the `vietnamese` subset. With
  Geist the browser falls back to a system font for those characters, so a word like
  "thửa" renders in two different typefaces. Verify after any font change that a served
  `@font-face` carries `unicode-range: ... u+1ea0-1ef9 ...`.
- **Banned:** `Inter`, generic system fonts, and all serif fonts.

## 4. Component Stylings
- **Buttons:** Flat, sharp. No outer glow or heavy shadows. Tactile -1px translate on active state with spring physics. Authority Navy fill for primary, transparent ghost/outline for secondary.
- **Cards:** Generously rounded corners (1rem). Diffused whisper shadow (`box-shadow: 0 4px 24px -4px rgba(0,0,0,0.03)`). Used only when elevation serves hierarchy (e.g., uploaded proof bundles). High-density dashboard views (Government) replace cards with border-top dividers and negative space.
- **Inputs:** Label above, helper/error below. Focus ring in Authority Navy. No floating labels. Minimal padding, highly legible.
- **Loaders:** Skeletal shimmer matching exact layout dimensions. No circular spinners.
- **Empty States:** Composed, typographic compositions with subtle mono-line illustrations — not just "No data" text.

## 5. Layout Principles
- **Grid-first Architecture:** CSS Grid over Flexbox math. No absolute-positioned content stacking.
- **Asymmetric Splits:** The Landing page uses a 60/40 or 70/30 split between Resident and Government entries, avoiding boring symmetric centering.
- **Dashboard Density:** Government portal uses a left-aligned sidebar (250px) with a max-width contained main content area (1200px).
- **Responsive:** Strict single-column collapse below 768px. No horizontal scroll under any circumstances.
- **Spacing:** Generous vertical section gaps (`clamp(3rem, 6vw, 5rem)`). Every element occupies its own clear spatial zone.

## 6. Motion & Interaction
This is a public-sector registry, so motion is restrained on purpose: it confirms
actions, it does not perform. Two utilities only, both in `app/globals.css`.

- **`ui-transition`** - the default. 180ms, `cubic-bezier(0.16, 1, 0.3, 1)`, scoped to
  `color, background-color, border-color, box-shadow, opacity, transform`. Never
  `transition-property: all`: that makes the browser watch layout properties too.
- **`spring-transition`** - overshoot, `transform`/`opacity` only, reserved for elements
  that actually travel (the arrow nudge on a CTA). An overshoot curve landing on a color
  change reads as a rendering bug, not as polish.
- **Reduced motion** is honoured globally by a `prefers-reduced-motion: reduce` block in
  `globals.css` that collapses every transition and animation.
- **No perpetual loops** except a spinner on work genuinely in flight (proving, signing).

## 7. Anti-Patterns (Banned)
- NO emojis.
- NO `Inter` or pure black (`#000000`).
- NO neon glows, oversized colored drop-shadows, or oversaturated accents.
- NO 3-column equal card layouts (use zig-zag, asymmetric, or CSS grid).
- NO AI copywriting clichés ("Elevate your land registry", "Seamless verification", "Next-Gen ZKP").
- NO fake round numbers in mockups.
- NO overlapping elements — clean spatial separation always.
- NO custom mouse cursors.

## 8. Accessibility Floor (non-negotiable)
- Every interactive element takes the global `:focus-visible` ring (2px Authority Navy,
  2px offset). Keyboard users must never lose the cursor.
- Navigation marks its current item with `aria-current="page"` AND a visual state. A nav
  whose four items render identically regardless of location is a defect, not minimalism.
- Icons that repeat an adjacent label are `aria-hidden`; icon-only controls carry an
  `sr-only` label.
- Form fields: label above (never a placeholder as label), error below wired through
  `aria-describedby` + `aria-invalid`, `role="alert"` on the error.

## 9. Responsive Contract
- **No fixed-width sidebar below `md`.** The government rail is `hidden md:flex`; phones
  get a header plus a four-item bottom tab bar. A 250px rail on a 375px screen leaves
  61px of content.
- Resident nav moves to a second header row below `sm` rather than compressing inline.
- Any page must survive 320px with no horizontal scroll.

## 10. Bundle Discipline
The wallet stack (wagmi + RainbowKit + WalletConnect) mounts in
`app/government/layout.tsx` only, never the root layout. The resident portal is
logged-out by design (D39, D49) and its on-chain verify is an `eth_call` that needs no
connector. Hoisting it to the root put ~665 KB of wallet code on the landing page and on
all three resident pages.
