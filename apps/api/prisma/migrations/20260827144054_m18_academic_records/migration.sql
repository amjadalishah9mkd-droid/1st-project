-- CreateEnum
CREATE TYPE "TermResultStatus" AS ENUM ('FINALIZED', 'SUPERSEDED', 'VOID');

-- CreateTable
CREATE TABLE "TermResult" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "status" "TermResultStatus" NOT NULL DEFAULT 'FINALIZED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "overallPercentage" DECIMAL(5,2) NOT NULL,
    "gradeLabel" TEXT,
    "gradePoint" DECIMAL(4,2),
    "termGpa" DECIMAL(4,2),
    "creditsAttempted" INTEGER NOT NULL,
    "creditsEarned" INTEGER,
    "attendancePercent" DECIMAL(5,2),
    "remark" TEXT,
    "finalizedById" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseResult" (
    "id" TEXT NOT NULL,
    "termResultId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "obtained" DECIMAL(10,2) NOT NULL,
    "maxMarks" DECIMAL(10,2) NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "gradeLabel" TEXT,
    "gradePoint" DECIMAL(4,2),
    "passed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TermResult_supersededById_key" ON "TermResult"("supersededById");

-- CreateIndex
CREATE INDEX "TermResult_collegeId_termId_idx" ON "TermResult"("collegeId", "termId");

-- CreateIndex
CREATE INDEX "TermResult_studentId_idx" ON "TermResult"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseResult_termResultId_courseId_key" ON "CourseResult"("termResultId", "courseId");

-- AddForeignKey
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermResult" ADD CONSTRAINT "TermResult_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "TermResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResult" ADD CONSTRAINT "CourseResult_termResultId_fkey" FOREIGN KEY ("termResultId") REFERENCES "TermResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResult" ADD CONSTRAINT "CourseResult_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseResult" ADD CONSTRAINT "CourseResult_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- M18-W1 raw-SQL invariant (design §12; M15/M16 partial-index precedent):
-- at most ONE active FINALIZED snapshot per student per term. Concurrent
-- finalizations collapse to exactly one winner at the database level.
CREATE UNIQUE INDEX "TermResult_one_finalized_per_student_term"
  ON "TermResult"("studentId", "termId")
  WHERE "status" = 'FINALIZED';
