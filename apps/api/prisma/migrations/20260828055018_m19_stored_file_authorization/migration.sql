-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('COMMUNITY_ATTACHMENT', 'SUBMISSION', 'EVIDENCE', 'OTHER');

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "purpose" "FilePurpose" NOT NULL DEFAULT 'OTHER',
    "ownerUserId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_key_key" ON "StoredFile"("key");

-- CreateIndex
CREATE INDEX "StoredFile_collegeId_idx" ON "StoredFile"("collegeId");

-- CreateIndex
CREATE INDEX "StoredFile_ownerUserId_idx" ON "StoredFile"("ownerUserId");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- M19-W1 backfill: create ownership rows for every legacy key whose owner and
-- college are DERIVABLE from existing domain rows. Keys that cannot be safely
-- derived get NO row and remain grandfathered (capability-URL behavior kept),
-- so no existing stored URL breaks. ON CONFLICT (key) DO NOTHING makes every
-- step idempotent and resolves the (theoretical) case of one key referenced
-- by multiple domain rows — first derivation wins.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Verification evidence (EvidenceFile is authoritative: key/college/owner).
INSERT INTO "StoredFile" ("id", "collegeId", "key", "purpose", "ownerUserId", "createdById", "createdAt")
SELECT gen_random_uuid()::text, e."collegeId", e."key", 'EVIDENCE'::"FilePurpose", e."uploaderId", e."uploaderId", e."createdAt"
FROM "EvidenceFile" e
ON CONFLICT ("key") DO NOTHING;

-- 2. Community post attachments (Post carries collegeId + authorId).
INSERT INTO "StoredFile" ("id", "collegeId", "key", "purpose", "ownerUserId", "createdById", "createdAt")
SELECT gen_random_uuid()::text, p."collegeId",
       substring(att.value->>'url' FROM 15) AS key,
       'COMMUNITY_ATTACHMENT'::"FilePurpose", p."authorId", p."authorId", p."createdAt"
FROM "Post" p,
     LATERAL jsonb_array_elements(p."attachments"::jsonb) AS att(value)
WHERE att.value->>'url' LIKE '/api/v1/files/%'
  AND substring(att.value->>'url' FROM 15) NOT LIKE '%/%'
ON CONFLICT ("key") DO NOTHING;

-- 3. Assignment attachments (college via Section; owner = assignment creator).
INSERT INTO "StoredFile" ("id", "collegeId", "key", "purpose", "ownerUserId", "createdById", "createdAt")
SELECT gen_random_uuid()::text, s."collegeId",
       substring(att.value->>'url' FROM 15) AS key,
       'OTHER'::"FilePurpose", a."createdById", a."createdById", a."createdAt"
FROM "Assignment" a
JOIN "Section" s ON s."id" = a."sectionId",
     LATERAL jsonb_array_elements(a."attachments"::jsonb) AS att(value)
WHERE att.value->>'url' LIKE '/api/v1/files/%'
  AND substring(att.value->>'url' FROM 15) NOT LIKE '%/%'
ON CONFLICT ("key") DO NOTHING;

-- 4. Submission files (college via Section; owner = the student's login user
--    where the profile is claimed; unclaimed profiles leave owner NULL —
--    college scoping still applies).
INSERT INTO "StoredFile" ("id", "collegeId", "key", "purpose", "ownerUserId", "createdById", "createdAt")
SELECT gen_random_uuid()::text, s."collegeId",
       substring(sub."fileUrl" FROM 15) AS key,
       'SUBMISSION'::"FilePurpose", sp."userId", sp."userId", sub."createdAt"
FROM "Submission" sub
JOIN "Assignment" a ON a."id" = sub."assignmentId"
JOIN "Section" s ON s."id" = a."sectionId"
JOIN "StudentProfile" sp ON sp."id" = sub."studentId"
WHERE sub."fileUrl" LIKE '/api/v1/files/%'
  AND substring(sub."fileUrl" FROM 15) NOT LIKE '%/%'
ON CONFLICT ("key") DO NOTHING;
