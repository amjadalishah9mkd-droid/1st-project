-- AlterTable
ALTER TABLE "User" ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusChangedById" TEXT,
ADD COLUMN     "statusReason" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
