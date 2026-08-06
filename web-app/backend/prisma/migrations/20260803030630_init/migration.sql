-- CreateEnum
CREATE TYPE "UseType" AS ENUM ('RESIDENTIAL', 'AGRICULTURAL', 'COMMERCIAL', 'INDUSTRIAL', 'FORESTRY');

-- CreateEnum
CREATE TYPE "EncumbranceStatus" AS ENUM ('FREE', 'MORTGAGED', 'LITIGATED', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "TenureType" AS ENUM ('PERPETUAL', 'FIXED_TERM', 'PROJECT_LEASEHOLD');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "properties" (
    "id" SERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "ownerCommitment" TEXT,
    "useType" "UseType" NOT NULL,
    "validityPeriod" TEXT NOT NULL,
    "encumbranceStatus" "EncumbranceStatus" NOT NULL,
    "tenureType" "TenureType" NOT NULL,
    "landUseCode" TEXT NOT NULL,
    "certificateSerial" TEXT NOT NULL,
    "bookEntryNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "area" DECIMAL(12,2) NOT NULL,
    "issuingAuthority" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "leaf" TEXT,
    "merkleProof" JSONB,
    "rootVersion" INTEGER,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merkle_roots" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "root" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merkle_roots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issued_bundles" (
    "id" SERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "claimToken" TEXT NOT NULL,
    "bundleZip" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issued_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_requests" (
    "id" SERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "newOwnerCommitment" TEXT NOT NULL,
    "oldRoot" TEXT NOT NULL,
    "newRoot" TEXT NOT NULL,
    "proof" JSONB NOT NULL,
    "publicSignals" JSONB NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "properties_propertyId_key" ON "properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "merkle_roots_version_key" ON "merkle_roots"("version");

-- CreateIndex
CREATE UNIQUE INDEX "issued_bundles_propertyId_key" ON "issued_bundles"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "issued_bundles_claimToken_key" ON "issued_bundles"("claimToken");
