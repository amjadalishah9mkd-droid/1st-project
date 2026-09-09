-- CreateEnum
CREATE TYPE "TermStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- AlterTable
ALTER TABLE "Term" ADD COLUMN     "status" "TermStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Term_collegeId_status_idx" ON "Term"("collegeId", "status");
