-- CreateTable
CREATE TABLE "properties" (
    "id" SERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "ownerCommitment" TEXT NOT NULL,
    "useType" TEXT NOT NULL,
    "validityPeriod" TEXT NOT NULL,
    "encumbranceStatus" TEXT NOT NULL,
    "assessedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "properties_propertyId_key" ON "properties"("propertyId");
