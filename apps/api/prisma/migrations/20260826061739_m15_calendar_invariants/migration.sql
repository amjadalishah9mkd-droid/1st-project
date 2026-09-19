-- CreateEnum
CREATE TYPE "TermRolloverStatus" AS ENUM ('DRAFT', 'EXECUTED');

-- CreateTable
CREATE TABLE "TermRollover" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "fromTermId" TEXT NOT NULL,
    "toTermId" TEXT NOT NULL,
    "status" "TermRolloverStatus" NOT NULL DEFAULT 'DRAFT',
    "plan" JSONB NOT NULL DEFAULT '{}',
    "counters" JSONB,
    "executedById" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermRollover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TermRollover_collegeId_status_idx" ON "TermRollover"("collegeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TermRollover_collegeId_toTermId_key" ON "TermRollover"("collegeId", "toTermId");

-- AddForeignKey
ALTER TABLE "TermRollover" ADD CONSTRAINT "TermRollover_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermRollover" ADD CONSTRAINT "TermRollover_fromTermId_fkey" FOREIGN KEY ("fromTermId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermRollover" ADD CONSTRAINT "TermRollover_toTermId_fkey" FOREIGN KEY ("toTermId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermRollover" ADD CONSTRAINT "TermRollover_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- M15-W1: database-level single-current-term invariant (tenant-scoped).
-- Prisma cannot express partial unique indexes; documented on the Term
-- model. Pre-checked: no college currently has more than one current term.
CREATE UNIQUE INDEX "Term_one_current_per_college" ON "Term" ("collegeId") WHERE "isCurrent";
