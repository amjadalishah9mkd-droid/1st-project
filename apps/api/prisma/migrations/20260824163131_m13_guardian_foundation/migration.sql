-- CreateEnum
CREATE TYPE "GuardianLinkStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- AlterEnum
ALTER TYPE "PermissionScope" ADD VALUE 'CHILD';

-- AlterEnum
ALTER TYPE "RoleKey" ADD VALUE 'GUARDIAN';

-- CreateTable
CREATE TABLE "GuardianLink" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "guardianUserId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "status" "GuardianLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardianLink_studentProfileId_idx" ON "GuardianLink"("studentProfileId");

-- CreateIndex
CREATE INDEX "GuardianLink_guardianUserId_status_idx" ON "GuardianLink"("guardianUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianLink_guardianUserId_studentProfileId_key" ON "GuardianLink"("guardianUserId", "studentProfileId");

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
