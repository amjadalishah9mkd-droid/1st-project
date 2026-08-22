-- CreateEnum
CREATE TYPE "UserVerification" AS ENUM ('LEGACY', 'UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "verificationStatus" "UserVerification" NOT NULL DEFAULT 'LEGACY',
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerSub" TEXT NOT NULL,
    "emailAtLink" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentIdentityClaim" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studentProfileId" TEXT,
    "claimedAdmissionNo" TEXT NOT NULL,
    "evidenceFileKey" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentIdentityClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_providerSub_key" ON "AuthIdentity"("provider", "providerSub");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "AuthIdentity"("userId", "provider");

-- CreateIndex
CREATE INDEX "StudentIdentityClaim_collegeId_status_idx" ON "StudentIdentityClaim"("collegeId", "status");

-- CreateIndex
CREATE INDEX "StudentIdentityClaim_userId_idx" ON "StudentIdentityClaim"("userId");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentIdentityClaim" ADD CONSTRAINT "StudentIdentityClaim_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentIdentityClaim" ADD CONSTRAINT "StudentIdentityClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentIdentityClaim" ADD CONSTRAINT "StudentIdentityClaim_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentIdentityClaim" ADD CONSTRAINT "StudentIdentityClaim_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- M11 duplicate-account prevention (blueprint §7): these invariants live in
-- PostgreSQL itself so concurrent claim submissions cannot race past
-- application-level checks.

-- One live (pending or approved) claim per real student identity.
CREATE UNIQUE INDEX "StudentIdentityClaim_live_profile_key"
  ON "StudentIdentityClaim" ("studentProfileId")
  WHERE "status" IN ('PENDING', 'APPROVED') AND "studentProfileId" IS NOT NULL;

-- One in-flight claim per claimant account.
CREATE UNIQUE INDEX "StudentIdentityClaim_pending_user_key"
  ON "StudentIdentityClaim" ("userId")
  WHERE "status" = 'PENDING';
