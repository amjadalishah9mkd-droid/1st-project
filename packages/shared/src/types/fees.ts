/** M6 API payload types — fees. */

import type { RefundAttemptStatus, RefundMethod } from '../enums';

export interface FeeStructureItem {
  id: string;
  termId: string;
  termLabel: string;
  courseId: string | null;
  courseCode: string | null;
  name: string;
  totalAmount: string;
  components: Array<{ id: string; label: string; amount: string }>;
  invoiceCount: number;
}

export interface InvoiceItem {
  id: string;
  invoiceNo: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  structureName: string;
  amount: string;
  paidAmount: string;
  balance: string;
  dueDate: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED';
}

/** M14-W4 — safe, read-only view of an online payment attempt. */
export interface PaymentAttemptItem {
  id: string;
  status:
    | 'CREATED'
    | 'PENDING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'REFUNDED';
  amount: string;
  currency: string;
  provider: string;
  createdAt: string;
  confirmedAt: string | null;
  failureCode: string | null;
}

export interface InvoiceDetail extends InvoiceItem {
  components: Array<{ label: string; amount: string }>;
  /** Online payment attempts, newest first (in-flight + historical). */
  attempts: PaymentAttemptItem[];
  payments: Array<{
    id: string;
    amount: string;
    method: string;
    reference: string | null;
    paidAt: string;
    recordedByName: string;
  }>;
}

/** M14-W5 — admin reconciliation row (attempt + invoice/student context). */
export interface ReconciliationAttemptItem {
  id: string;
  invoiceId: string;
  invoiceNo: string;
  studentName: string;
  rollNo: string;
  amount: string;
  currency: string;
  provider: string;
  providerRef: string | null;
  status:
    | 'CREATED'
    | 'PENDING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'REFUNDED';
  overpaid: boolean;
  failureCode: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

/** M14-W5 — unmatched gateway deliveries (no tenant attribution by design). */
export interface UnmatchedGatewayEventItem {
  id: string;
  provider: string;
  eventId: string;
  outcome: string;
  receivedAt: string;
}

export interface GenerateInvoicesResult {
  created: number;
  skipped: number;
}

export interface FeeSummary {
  invoicedTotal: string;
  collectedTotal: string;
  outstandingTotal: string;
  invoiceCount: number;
  paidCount: number;
  overdueCount: number;
}

// ── M16-W1: refund read contracts (design §§19–21; endpoints in W2) ────


/** One refund attempt as listed on invoice detail / reconciliation. */
export interface RefundAttemptItem {
  id: string;
  paymentId: string;
  invoiceId: string;
  invoiceNo: string;
  amount: string;
  currency: string;
  reason: string;
  method: RefundMethod;
  provider: string | null;
  providerRefundRef: string | null;
  status: RefundAttemptStatus;
  failureCode: string | null;
  requestedById: string;
  confirmedAt: string | null;
  createdAt: string;
}

/** Immutable settled refund row (money actually returned). */
export interface RefundItem {
  id: string;
  paymentId: string;
  invoiceId: string;
  amount: string;
  method: RefundMethod;
  reference: string | null;
  refundedAt: string;
}

/** Per-payment refund summary: history + server-computed headroom. */
export interface PaymentRefundSummary {
  paymentId: string;
  paymentAmount: string;
  refunded: string;
  refundable: string;
  refunds: RefundItem[];
  attempts: RefundAttemptItem[];
}

// ── M20 finance documents ───────────────────────────────────────

export type FinanceDocumentKind = 'PAYMENT_RECEIPT' | 'REFUND_DOCUMENT';
export type FinanceDocumentStatus = 'ACTIVE' | 'VOID';

/**
 * M20-W2 — the public finance-document contract: EXACTLY the frozen
 * issuance snapshot plus lifecycle metadata. Deliberately excludes internal
 * ids (payment/refund/invoice/college cuids), sequence internals, staff
 * contact data and unmasked references — the document IS the payload.
 */
export interface FinanceDocumentItem {
  id: string;
  kind: FinanceDocumentKind;
  status: FinanceDocumentStatus;
  receiptNo: string;
  studentName: string;
  admissionNo: string;
  rollNo: string;
  invoiceNo: string;
  structureName: string;
  collegeName: string;
  collegeCode: string;
  amount: string;
  method: string;
  referenceMasked: string | null;
  paidAt: string;
  invoiceAmount: string;
  balanceAfter: string;
  receivedByName: string | null;
  parentReceiptNo: string | null;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
