import type { InvoiceItem } from '@campusos/shared';

export function invoiceTone(
  status: InvoiceItem['status'],
): 'neutral' | 'success' | 'warning' | 'danger' | 'brand' {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'PARTIAL':
      return 'brand';
    case 'OVERDUE':
      return 'danger';
    case 'CANCELLED':
      return 'neutral';
    default:
      return 'warning';
  }
}
