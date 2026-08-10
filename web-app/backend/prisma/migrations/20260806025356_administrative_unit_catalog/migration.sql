-- CreateEnum
CREATE TYPE "AdministrativeUnitType" AS ENUM ('PHUONG', 'XA', 'DAC_KHU');

-- CreateTable
CREATE TABLE "administrative_units" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AdministrativeUnitType" NOT NULL,
    "province" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "administrative_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "administrative_units_province_idx" ON "administrative_units"("province");

-- CreateIndex
CREATE UNIQUE INDEX "administrative_units_name_province_key" ON "administrative_units"("name", "province");
