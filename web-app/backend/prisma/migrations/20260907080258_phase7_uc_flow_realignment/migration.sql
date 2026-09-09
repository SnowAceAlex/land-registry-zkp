/*
  Warnings:

  - You are about to drop the `issued_bundles` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('IMPORTED', 'ISSUED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "RevocationStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PropertyEventKind" AS ENUM ('ISSUED', 'TRANSFERRED', 'REVOKED', 'ENCUMBRANCE_CHANGED', 'VALIDITY_CHANGED');

-- AlterEnum
ALTER TYPE "TransferStatus" ADD VALUE 'PUBLISHED';

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "issuanceBatchId" INTEGER,
ADD COLUMN     "status" "PropertyStatus" NOT NULL DEFAULT 'IMPORTED';

-- Backfill: the DEFAULT above classifies every existing row as IMPORTED,
-- including rows already issued before this migration (identified by a
-- non-null ownerCommitment). Without this, a fresh `migrate deploy` against
-- previously-issued data drops those properties out of the Merkle tree with
-- no error, because tree membership now reads `status` instead of
-- `ownerCommitment IS NOT NULL` (D45).
UPDATE "properties" SET "status" = 'ISSUED' WHERE "ownerCommitment" IS NOT NULL;

-- AlterTable
ALTER TABLE "transfer_requests" ADD COLUMN     "changeSetId" INTEGER;

-- DropTable
DROP TABLE "issued_bundles";

-- CreateTable
CREATE TABLE "issuance_batches" (
    "id" SERIAL NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "newRoot" TEXT NOT NULL,
    "rootVersion" INTEGER,
    "txHash" TEXT,
    "draftSecrets" JSONB,
    "archiveZip" BYTEA,
    "archiveExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "issuance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_sets" (
    "id" SERIAL NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "newRoot" TEXT NOT NULL,
    "rootVersion" INTEGER,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "change_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revocations" (
    "id" SERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reasonCode" INTEGER NOT NULL,
    "detailText" TEXT NOT NULL,
    "detailHash" TEXT NOT NULL,
    "status" "RevocationStatus" NOT NULL DEFAULT 'PENDING',
    "changeSetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "revocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_events" (
    "id" SERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "PropertyEventKind" NOT NULL,
    "rootVersion" INTEGER,
    "txHash" TEXT,
    "previousOwnerCommitment" TEXT,
    "newOwnerCommitment" TEXT,
    "previousLeaf" TEXT,
    "newLeaf" TEXT,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issuance_batches_status_idx" ON "issuance_batches"("status");

-- CreateIndex
CREATE INDEX "change_sets_status_idx" ON "change_sets"("status");

-- CreateIndex
CREATE INDEX "revocations_status_idx" ON "revocations"("status");

-- CreateIndex
CREATE INDEX "revocations_propertyId_idx" ON "revocations"("propertyId");

-- CreateIndex
CREATE INDEX "property_events_propertyId_occurredAt_idx" ON "property_events"("propertyId", "occurredAt");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_issuanceBatchId_fkey" FOREIGN KEY ("issuanceBatchId") REFERENCES "issuance_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revocations" ADD CONSTRAINT "revocations_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "change_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "change_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
