/*
  D77 — the buyer's secret is issued by the backend and delivered in the change
  set's archive, exactly like an issuance round (D14/D42). Additive only.

  Written by hand, like 20260923040000_d72_merkle_nodes: `prisma migrate dev`
  trips over the edited Phase-7 migration's checksum and demands a reset.
  Apply with `prisma migrate deploy`.

  ⚠️ PENDING/APPROVED transfer requests created before this migration carry no
  secret (the buyer took it home from the counter). ChangeSetService refuses to
  batch them: reject them and redo the transfer at the counter.
*/

-- AlterTable
ALTER TABLE "transfer_requests" ADD COLUMN "newOwnerSecret" TEXT;

-- AlterTable
ALTER TABLE "change_sets" ADD COLUMN "archiveExpiresAt" TIMESTAMP(3),
ADD COLUMN "archiveZip" BYTEA;
