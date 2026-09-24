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
 * The commitment of the plot's NEXT owner, derived from its CURRENT one.
 *
 * ⚠️ Chained from the current commitment, not from the propertyId. An earlier
 * version derived it from the plot id alone, which meant transferring a plot
 * twice produced the same commitment the second time — the leaf did not move,
 * the projected root equalled the published one, and `publishRoot` reverted
 * with `DuplicateRoot`. That makes a replay un-re-runnable against a database
 * that has already been replayed once.
 *
 * Still fully deterministic: same starting state, same sequence of roots.
 */
export async function nextOwnerCommitment(currentCommitment: string): Promise<string> {
  const nextSecret = await poseidonHash([BigInt(currentCommitment), BENCH_SECRET_SEED]);
  return (await poseidonHash([nextSecret])).toString();
}
