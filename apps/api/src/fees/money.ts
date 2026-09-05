/**
 * M17-W2 — the ONE canonical net-paid calculation (design §12).
 *
 *   netPaid(invoice) = Σ Payment.amount − Σ Refund.amount
 *
 * Payment and Refund rows are immutable additive ledgers (M16); every
 * balance/status/summary/dashboard/export figure derives from this net.
 * All eight reducer sites use this helper — never duplicate the
 * arithmetic (that is exactly how DEFECT-1 happened).
 */
export interface NetPaidRows {
  payments: Array<{ amount: unknown }>;
  refunds: Array<{ amount: unknown }>;
}

export function netPaid(rows: NetPaidRows): number {
  const paid = rows.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const refunded = rows.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
  return paid - refunded;
}
