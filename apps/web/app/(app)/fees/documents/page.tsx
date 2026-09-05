'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { FinanceDocumentItem } from '@campusos/shared';
import { useList } from '@/lib/hooks/use-list';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';
import { formatAmount, formatDateTime } from '@/lib/format';

/**
 * M20-W3 — finance documents list. Pure presentation over
 * GET /fees/documents: the backend applies fees.read scopes (students see
 * OWN, guardians pass ?studentId= for a linked child, staff see the
 * college). No financial values are computed here — every figure is the
 * frozen snapshot.
 */
export default function FinanceDocumentsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const studentId = search.get('studentId') ?? undefined;
  const list = useList<FinanceDocumentItem>('/fees/documents', { studentId });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Receipts & refund documents"
        description="Issued finance documents. Values are frozen at issuance — open a document to print an official copy."
      />
      <DataTable
        rowKey={(row) => row.id}
        rows={list.rows}
        meta={list.meta}
        loading={list.loading}
        error={list.error}
        onPageChange={list.setPage}
        onRetry={list.refetch}
        onRowClick={(row) => router.push(`/fees/documents/${row.id}`)}
        emptyTitle="No documents"
        emptyMessage="Receipts appear here when payments are recorded or settled."
        columns={[
          {
            key: 'no',
            header: 'Document',
            render: (row) => (
              <span className="font-mono text-xs">{row.receiptNo}</span>
            ),
          },
          {
            key: 'kind',
            header: 'Type',
            render: (row) =>
              row.kind === 'PAYMENT_RECEIPT' ? 'Receipt' : 'Refund document',
          },
          { key: 'student', header: 'Student', render: (row) => row.studentName },
          {
            key: 'invoice',
            header: 'Invoice',
            render: (row) => <span className="font-mono text-xs">{row.invoiceNo}</span>,
          },
          { key: 'amount', header: 'Amount', render: (row) => formatAmount(row.amount) },
          { key: 'issued', header: 'Issued', render: (row) => formatDateTime(row.issuedAt) },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <Badge tone={row.status === 'VOID' ? 'danger' : 'success'}>
                {row.status}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  );
}
