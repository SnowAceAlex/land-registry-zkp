/**
 * proof/proof-etag.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The validator for `GET /api/proof/:propertyId` (D74).
 *
 * That response is public data and changes ONLY when a root is published: a new
 * root alters the Merkle path of every plot, and with no publish nothing alters
 * it at all. So `(rootVersion, propertyId)` is an exact validator — not an
 * approximation, and it needs no database read to compute.
 *
 * That is what makes a 304 free: it never touches the node table. It is the
 * second "server load" figure in Chapter 5, independent of the ZKP one.
 *
 * A revocation also comes with a publish (D45/D46), so it moves the ETag too —
 * there is no path by which a revoked certificate keeps being served from a
 * cache.
 *
 * The `v`/`p` markers are load-bearing: plain concatenation would let
 * (1, '23') and (12, '3') collide, and a client could be handed a 304 that
 * belongs to a different plot.
 */
export function proofETag(rootVersion: number, propertyId: string): string {
  return `"v${rootVersion}-p${propertyId}"`;
}
