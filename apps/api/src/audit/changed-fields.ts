/**
 * M23-W2 (S-2) — audit metadata helpers.
 *
 * Data-minimization rule for the configuration-mutation audit events:
 * the audit record says WHICH fields changed, not what they were changed
 * to. Recording field NAMES keeps the trail useful for answering "who
 * changed what, when" while keeping arbitrary client payloads, free-text
 * bodies, personal data and secrets out of `AuditLog.metadata` entirely.
 *
 * `changedFields` is a pure function over the already-validated input and
 * the row that was read under the caller's tenant scope, so the result is
 * entirely server-derived and cannot be influenced by a client sending
 * extra keys: only keys listed in `fields` are ever considered.
 */

/** Value shapes we compare. Dates and Decimals are normalized to strings. */
type Comparable = unknown;

function normalize(value: Comparable): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimal and other value objects expose a faithful toString().
  if (typeof value === 'object') return String(value);
  return String(value);
}

/**
 * Returns the sorted names of the fields the caller actually changed.
 *
 * A field is "changed" only when the input supplied it (not `undefined`)
 * AND its normalized value differs from the stored value. A no-op PATCH
 * therefore yields `[]` rather than a misleading list of every field the
 * client happened to echo back.
 */
export function changedFields<K extends string>(
  fields: readonly K[],
  before: Record<string, Comparable>,
  after: Partial<Record<K, Comparable>>,
): K[] {
  const changed: K[] = [];
  for (const field of fields) {
    const next = normalize(after[field]);
    if (next === undefined) continue; // not supplied — not a change
    if (next !== normalize(before[field])) changed.push(field);
  }
  return changed.sort();
}
