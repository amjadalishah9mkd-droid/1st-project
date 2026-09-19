-- CreateEnum
CREATE TYPE "RefundAttemptStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('PROVIDER', 'RECORDED');

-- AlterEnum
ALTER TYPE "RoleKey" ADD VALUE 'ACCOUNTANT';

-- CreateTable
CREATE TABLE "RefundAttempt" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "reason" TEXT NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "provider" TEXT,
    "providerRefundRef" TEXT,
    "status" "RefundAttemptStatus" NOT NULL DEFAULT 'REQUESTED',
    "failureCode" TEXT,
    "requestedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "refundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "reference" TEXT,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefundAttempt_refundId_key" ON "RefundAttempt"("refundId");

-- CreateIndex
CREATE INDEX "RefundAttempt_collegeId_status_idx" ON "RefundAttempt"("collegeId", "status");

-- CreateIndex
CREATE INDEX "RefundAttempt_paymentId_idx" ON "RefundAttempt"("paymentId");

-- CreateIndex
CREATE INDEX "RefundAttempt_invoiceId_idx" ON "RefundAttempt"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundAttempt_provider_providerRefundRef_key" ON "RefundAttempt"("provider", "providerRefundRef");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Refund_invoiceId_idx" ON "Refund"("invoiceId");

-- AddForeignKey
ALTER TABLE "RefundAttempt" ADD CONSTRAINT "RefundAttempt_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAttempt" ADD CONSTRAINT "RefundAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAttempt" ADD CONSTRAINT "RefundAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAttempt" ADD CONSTRAINT "RefundAttempt_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAttempt" ADD CONSTRAINT "RefundAttempt_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- M16-W1 raw-SQL invariants (design §§9,11,12; M15 partial-index precedent).

-- At most ONE in-flight refund attempt per payment: concurrent duplicate
-- creations collapse to exactly one at the database level.
CREATE UNIQUE INDEX "RefundAttempt_one_inflight_per_payment"
  ON "RefundAttempt"("paymentId")
  WHERE "status" IN ('REQUESTED', 'PROCESSING');

-- Money invariant: refund amounts are strictly positive.
ALTER TABLE "RefundAttempt"
  ADD CONSTRAINT "RefundAttempt_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive" CHECK ("amount" > 0);
