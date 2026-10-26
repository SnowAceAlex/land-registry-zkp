/*
  Phase 10 (D84) — issuance publishes through the change-set round, so the
  two-phase IssuanceBatch flow and the single per-round archive are gone.

  ⚠️ DESTRUCTIVE: existing issuance-batch archives and old single change-set
  archives (change_sets.archiveZip) are lost. Dev data is regenerable; the
  per-office archives live in change_set_archives.

  Written by hand, like 20260924090000_d77_buyer_secret_archive.
*/

-- DropForeignKey
ALTER TABLE "properties" DROP CONSTRAINT "properties_issuanceBatchId_fkey";

-- AlterTable
ALTER TABLE "properties" DROP COLUMN "issuanceBatchId";

-- AlterTable
ALTER TABLE "change_sets" DROP COLUMN "archiveZip",
DROP COLUMN "archiveExpiresAt";

-- DropTable
DROP TABLE "issuance_batches";
