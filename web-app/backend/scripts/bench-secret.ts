/**
 * scripts/bench-secret.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The one thing every bench script needs from every other: how a bench plot's
 * owner secret is derived.
 *
 * ⚠️ BENCH ONLY. The seed is a public constant, so anyone reading this file can
 * compute the secret of any plot — which is precisely what D14 forbids on a
 * real deployment. It exists so a harness can prove ownership of 2.5 million
 * plots without storing 2.5 million secrets. `bench-seed-genesis.ts` refuses to
 * run against a non-empty registry, and that refusal is the guard that matters.
 *
 * ⚠️ KEEP THIS FILE FREE OF NEST IMPORTS. It used to live in
 * `bench-seed-genesis.ts`, which imports `AppModule` at the top level — so any
 * script that wanted the derivation booted a whole second application context,
 * complete with its own RPC connection and database pool. Nothing here may
 * import anything but the shared crypto.
 */
import { poseidonHash } from '@land-registry/blockchain/shared';

/** Seed behind every bench secret. Public on purpose — see above. */
export const BENCH_SECRET_SEED = 424_242n;

/** The owner secret of a bench plot, recomputable from any script. */
export async function benchOwnerSecret(propertyId: bigint): Promise<bigint> {
  return poseidonHash([BENCH_SECRET_SEED, propertyId]);
}

/**
 * The commitment of the plot's NEXT owner — one step along the same chain.
 *
 * Deterministic so a replay can be re-run against a freshly seeded database and
 * produce exactly the same roots.
 */
export async function nextOwnerCommitment(propertyId: string): Promise<string> {
  const nextSecret = await poseidonHash([await benchOwnerSecret(BigInt(propertyId)), 1n]);
  return (await poseidonHash([nextSecret])).toString();
}
