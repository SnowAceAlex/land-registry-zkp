-- Audit fixes: separate "đối tượng sử dụng đất" from "loại đất" (LC-02/TN-01/TN-02),
-- and add the two GCN fields the certificate template was missing (PDF-03).

-- CreateEnum
CREATE TYPE "LandUserType" AS ENUM ('CNV', 'CDS', 'TKT', 'TCC', 'TSN');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "landUserType" "LandUserType",
ADD COLUMN     "mapSheetNumber" TEXT,
ADD COLUMN     "landOrigin" TEXT;
