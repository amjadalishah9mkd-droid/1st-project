const tones = {
  neutral: 'bg-surface-sunken text-ink-secondary border-line',
  success: 'bg-success-50 text-success-700 border-success-500/30',
  warning: 'bg-warning-50 text-warning-700 border-warning-500/30',
  danger: 'bg-danger-50 text-danger-700 border-danger-500/30',
  brand: 'bg-brand-50 text-brand-800 border-brand-200',
} as const;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function statusTone(
  status: string,
): keyof typeof tones {
  switch (status) {
    case 'ACTIVE':
    case 'ENROLLED':
      return 'success';
    case 'SUSPENDED':
    case 'OVERDUE':
      return 'danger';
    case 'ARCHIVED':
    case 'WITHDRAWN':
    case 'DROPPED':
      return 'warning';
    default:
      return 'neutral';
  }
}
