-- CreateEnum
CREATE TYPE "FinanceDocumentKind" AS ENUM ('PAYMENT_RECEIPT', 'REFUND_DOCUMENT');

-- CreateEnum
CREATE TYPE "FinanceDocumentStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateTable
CREATE TABLE "FinanceDocument" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "kind" "FinanceDocumentKind" NOT NULL,
    "status" "FinanceDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "receiptNo" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "paymentId" TEXT,
    "refundId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "admissionNo" TEXT NOT NULL,
    "rollNo" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "structureName" TEXT NOT NULL,
    "collegeName" TEXT NOT NULL,
    "collegeCode" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL,
    "referenceMasked" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "invoiceAmount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "receivedByName" TEXT,
    "parentReceiptNo" TEXT,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDocument_paymentId_key" ON "FinanceDocument"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDocument_refundId_key" ON "FinanceDocument"("refundId");

-- CreateIndex
CREATE INDEX "FinanceDocument_collegeId_kind_idx" ON "FinanceDocument"("collegeId", "kind");

-- CreateIndex
CREATE INDEX "FinanceDocument_invoiceId_idx" ON "FinanceDocument"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDocument_collegeId_receiptNo_key" ON "FinanceDocument"("collegeId", "receiptNo");

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
