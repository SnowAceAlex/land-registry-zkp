/*
  Phase 10 (D84-D90) — land offices, office credentials, issuance requests,
  per-office change-set archives and property lineage.

  Additive except the NOT NULL on transfer_requests/revocations."officeId", which is
  backfilled to HQ first. Written by hand, like 20260924090000_d77_buyer_secret_archive.
  Apply with `prisma migrate deploy` (or `prisma migrate reset` on a dev DB).
  Branch offices CN01..CN38 are loaded by `seed:land-offices`, not here.
*/

-- CreateEnum
CREATE TYPE "LandOfficeKind" AS ENUM ('HEAD_OFFICE', 'SITE', 'BRANCH');

-- CreateEnum
CREATE TYPE "IssuanceRequestStatus" AS ENUM ('READY', 'PUBLISHED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "landOfficeId" INTEGER;

-- AlterTable
ALTER TABLE "administrative_units" ADD COLUMN     "landOfficeId" INTEGER;

-- AlterTable
ALTER TABLE "change_sets" ADD COLUMN     "confirmedByOfficeId" INTEGER,
ADD COLUMN     "createdByOfficeId" INTEGER;

-- AlterTable
ALTER TABLE "revocations" ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "heldReason" TEXT,
ADD COLUMN     "landOfficeId" INTEGER,
ADD COLUMN     "officeId" INTEGER;

-- AlterTable
ALTER TABLE "transfer_requests" ADD COLUMN     "approvedByOfficeId" INTEGER,
ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "heldReason" TEXT,
ADD COLUMN     "landOfficeId" INTEGER,
ADD COLUMN     "officeId" INTEGER;

-- CreateTable
CREATE TABLE "land_offices" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LandOfficeKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "land_offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_credentials" (
    "id" SERIAL NOT NULL,
    "officeId" INTEGER NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "office_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_set_archives" (
    "id" SERIAL NOT NULL,
    "changeSetId" INTEGER NOT NULL,
    "officeId" INTEGER NOT NULL,
    "zip" BYTEA,
    "propertyCount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstDownloadedAt" TIMESTAMP(3),
    "firstDownloadedByOfficeId" INTEGER,

    CONSTRAINT "change_set_archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issuance_requests" (
    "id" SERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "ownerSecret" TEXT,
    "ownerCommitment" TEXT NOT NULL,
    "status" "IssuanceRequestStatus" NOT NULL DEFAULT 'READY',
    "officeId" INTEGER NOT NULL,
    "landOfficeId" INTEGER,
    "heldAt" TIMESTAMP(3),
    "heldReason" TEXT,
    "changeSetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "issuance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_lineage" (
    "predecessorPropertyId" TEXT NOT NULL,
    "successorPropertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_lineage_pkey" PRIMARY KEY ("predecessorPropertyId","successorPropertyId")
);

-- Seed the central offices
INSERT INTO "land_offices" ("code","name","kind") VALUES
  ('HQ','Văn phòng Đăng ký đất đai TP.HCM — Trụ sở chính','HEAD_OFFICE'),
  ('CS2','Văn phòng Đăng ký đất đai TP.HCM — Cơ sở 2','SITE'),
  ('CS3','Văn phòng Đăng ký đất đai TP.HCM — Cơ sở 3','SITE');

-- Backfill existing procedures to HQ, then enforce NOT NULL
UPDATE "transfer_requests" SET "officeId" = (SELECT "id" FROM "land_offices" WHERE "code" = 'HQ');
UPDATE "revocations" SET "officeId" = (SELECT "id" FROM "land_offices" WHERE "code" = 'HQ');
ALTER TABLE "transfer_requests" ALTER COLUMN "officeId" SET NOT NULL;
ALTER TABLE "revocations" ALTER COLUMN "officeId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "land_offices_code_key" ON "land_offices"("code");

-- CreateIndex
CREATE UNIQUE INDEX "office_credentials_keyHash_key" ON "office_credentials"("keyHash");

-- CreateIndex
CREATE INDEX "office_credentials_officeId_idx" ON "office_credentials"("officeId");

-- CreateIndex
CREATE INDEX "change_set_archives_officeId_idx" ON "change_set_archives"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "change_set_archives_changeSetId_officeId_key" ON "change_set_archives"("changeSetId", "officeId");

-- CreateIndex
CREATE INDEX "issuance_requests_status_idx" ON "issuance_requests"("status");

-- CreateIndex
CREATE INDEX "issuance_requests_propertyId_idx" ON "issuance_requests"("propertyId");

-- CreateIndex
CREATE INDEX "issuance_requests_landOfficeId_status_idx" ON "issuance_requests"("landOfficeId", "status");

-- CreateIndex
CREATE INDEX "property_lineage_successorPropertyId_idx" ON "property_lineage"("successorPropertyId");

-- CreateIndex
CREATE INDEX "properties_landOfficeId_status_idx" ON "properties"("landOfficeId", "status");

-- CreateIndex
CREATE INDEX "administrative_units_landOfficeId_idx" ON "administrative_units"("landOfficeId");

-- CreateIndex
CREATE INDEX "revocations_landOfficeId_status_idx" ON "revocations"("landOfficeId", "status");

-- CreateIndex
CREATE INDEX "transfer_requests_landOfficeId_status_idx" ON "transfer_requests"("landOfficeId", "status");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_landOfficeId_fkey" FOREIGN KEY ("landOfficeId") REFERENCES "land_offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administrative_units" ADD CONSTRAINT "administrative_units_landOfficeId_fkey" FOREIGN KEY ("landOfficeId") REFERENCES "land_offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_credentials" ADD CONSTRAINT "office_credentials_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "land_offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_set_archives" ADD CONSTRAINT "change_set_archives_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "change_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_set_archives" ADD CONSTRAINT "change_set_archives_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "land_offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issuance_requests" ADD CONSTRAINT "issuance_requests_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "change_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
