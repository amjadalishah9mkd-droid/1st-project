/** Shared display formatting (M9 polish). */

const numberFormat = new Intl.NumberFormat('en-GB');

/** Amounts with thousands grouping (currency-symbol-free per MVP scope). */
export function formatAmount(value: string | number): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(numeric)) return String(value);
  return numberFormat.format(numeric);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Fires the bell to re-poll immediately (after read/read-all mutations). */
export function refreshUnreadBadge(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('campusos:unread-refresh'));
  }
}
