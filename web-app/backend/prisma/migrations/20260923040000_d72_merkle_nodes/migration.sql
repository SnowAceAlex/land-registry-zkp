/*
  Warnings:

  - You are about to drop the column `merkleProof` on the `properties` table. It holds
    the cached Merkle path of every issued plot. That cache is what D72 removes: the
    tree itself now lives in `merkle_nodes`, and a proof is TREE_DEPTH key lookups
    away, so keeping a per-plot copy meant rewriting every row on every publish
    (~4-5 GB at HCMC scale, inside a single transaction).

    The dropped values are regenerable — run `pnpm --filter backend run tree:bootstrap`
    after this migration to build `merkle_nodes` from the `properties` rows.

  Written by hand rather than by `prisma migrate dev`, which cannot confirm a
  destructive column drop in a non-interactive session. Apply with
  `prisma migrate deploy`.
*/

-- DropColumn: the per-property proof cache (D72)
ALTER TABLE "properties" DROP COLUMN "merkleProof";

-- CreateIndex: tree membership is `status = 'ISSUED'` (D45), so every tree load
-- filters on it. Without this it is a sequential scan over the whole cadastre.
CREATE INDEX "properties_status_idx" ON "properties"("status");

-- CreateTable: the sparse tree, stored (D72).
-- Occupied nodes only — a missing row means "empty subtree" and is answered from
-- zeroHashes[height]. height 0 = leaf (index = propertyId, D41),
-- height TREE_DEPTH = root.
CREATE TABLE "merkle_nodes" (
    "height" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "merkle_nodes_pkey" PRIMARY KEY ("height","index")
);
