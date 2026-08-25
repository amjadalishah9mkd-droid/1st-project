/** M6 API payload types — fees. */

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
