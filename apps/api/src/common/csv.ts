/**
 * M12-W3 — CSV generation helper.
 * RFC-4180-style quoting plus a spreadsheet formula-injection guard:
 * cells beginning with = + - @ are prefixed with a single quote so they
 * are never evaluated when opened in Excel/Sheets.
 */
export const CSV_ROW_CAP = 50_000;

export class CsvTooLargeError extends Error {
  constructor() {
    super('Export exceeds the row cap');
  }
}

function escapeCell(value: string | number | null | undefined): string {
  let cell = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\r\n]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function toCsv(
  header: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  if (rows.length > CSV_ROW_CAP) {
    throw new CsvTooLargeError();
  }
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
