/**
 * features/resident/verify/lib/trusted-root.ts — the root CA this verifier pins (D78).
 *
 * Inlined at BUILD time by `next.config.ts` from `pki/root-ca.cert.pem` (or
 * `TRUSTED_ROOT_CA_PATH`), the way a browser ships its root store. It must
 * never come from the receipt or the backend: those are exactly what an
 * impostor controls, and a root they supply proves nothing.
 *
 * Empty at build time → null → link 1 reports `not-verifiable`. After
 * `cert:generate` creates or replaces the root, the frontend has to be rebuilt
 * (or the dev server restarted) to pin the new one.
 *
 * `process.env.TRUSTED_ROOT_CA_PEM` is spelled out in full on purpose: Next
 * replaces that exact expression, and a destructured `process.env` is not
 * replaced at all.
 */
export const TRUSTED_ROOT_CA_PEM: string | null = process.env.TRUSTED_ROOT_CA_PEM || null;
