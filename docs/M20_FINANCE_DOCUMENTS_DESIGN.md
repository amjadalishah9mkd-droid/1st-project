# M20 — Finance Documents / Receipts Design (W0: discovery + design ONLY)

Status: DESIGN. Nothing in this document is implemented. Baseline HEAD
`cd7b10c` (M19 CLOSED): 574/574 tests (43 suites), typecheck 0, 13
migrations, prisma validate clean, API/web prod builds green, containers
healthy (api/web/postgres + backup sidecar), restore drill PASS.

## 1. Executive summary

CampusOS has a mature, immutable money ledger (Payment/Refund rows are
never mutated; `netPaid()` in `apps/api/src/fees/money.ts:16` is the single
money-truth reducer) but **zero financial documents**: no receipts, no
receipt numbers, no printable payment confirmation, no invoice PDF, no
refund document — "receipt" appears only in design docs
(`docs/M19_PLATFORM_HARDENING_DESIGN.md:39,73,85,258`,
`docs/M16_REFUNDS_DESIGN.md:469`). The repository's proven document pattern
is the M12-W3/M18 browser-print experience (`window.print()` +
`@media print` in `apps/web/app/globals.css:14–27`, used by
`results/transcript`, `results/report/[examId]`, `results/record/[termId]`).
RECOMMENDED M20: **Option B — immutable snapshot receipts (payment +
refund documents) with college-scoped numbering, rendered via the existing
browser-print pattern; server-side PDF explicitly deferred** (O-15). This
retires the "receipts/PDF platform (M20 candidate)" debt entry with the
smallest new surface consistent with the M18 principle that finalized
historical records must not depend on mutable live data.

## 2. Baseline

See header. Verified before discovery: HEAD `cd7b10c` = remote, tree
clean, 574/574, typecheck 0, 13 migrations up to date, all containers
healthy.

## 3. Current finance architecture (source-traced)

Models (`apps/api/prisma/schema.prisma`):
- **FeeStructure** (:1077) collegeId-tenant; mutable name/totalAmount
  (blocked for CLOSED terms); components replaced wholesale on update
  (`fees.service.ts:214–233`). NOT a safe document source (mutable).
- **FeeComponent** (:1097) cascade child of structure; replaced on update.
  NOT safe as a document source.
- **Invoice** (:1110) collegeId; `@@unique([collegeId, invoiceNo])`;
  `invoiceNo = INV-<year>-<seq5>` generated from a per-college count inside
  the generate transaction (`fees.service.ts:288–306`). Only `status` ever
  mutates (PENDING→PARTIAL/PAID, lazy OVERDUE, CANCELLED only at zero
  payments, refunds walk status back down — `fees.service.ts:337–347,
  481–506, 556–571`; `refunds.service.ts:112–131`). `amount`/`invoiceNo`
  immutable (M16 D-5). SAFE as a document source for amount/invoiceNo, NOT
  for status.
- **Payment** (:1135) no collegeId (tenancy via invoice); **immutable after
  creation** ("settled money only", `payments.service.ts:32–34`). Fields:
  amount, method (CASH/BANK_TRANSFER/CHEQUE/OTHER/ONLINE), reference
  (manual ref or gateway providerRef), paidAt, recordedById?. SAFE and the
  natural receipt anchor.
- **PaymentAttempt** (:1159) own collegeId; CAS state machine
  CREATED→PENDING→SUCCEEDED/FAILED/EXPIRED/CANCELLED; frozen amount;
  `@@unique([provider, providerRef])`, `paymentId @unique`. Attempts are
  NOT money — not a receipt source.
- **Refund** (:1272) "IMMUTABLE after creation … settled money-out
  ledger"; amount, method PROVIDER/RECORDED, reference (Safepay
  `refund_…` token or null), refundedAt, recordedById?, `attempt?`. SAFE
  anchor for a refund document.
- **RefundAttempt** (:1235) partial-refund workflow with DB invariants
  (one in-flight per payment). Not money; not a document source.
- **GatewayEvent**: webhook idempotency ledger; no payloads.

Flows: manual recording under invoice `FOR UPDATE` with OVERPAYMENT
rejection (`fees.service.ts:542–571`); online settlement materializes the
Payment only on verified provider truth (`payments.service.ts:400–510`);
refunds support partials with headroom re-checked under lock
(`refunds.service.ts:233–240, 369–379`), typed-amount confirmation, and
reporter-based verification. Balance = `Invoice.amount − netPaid`.

Authorization (`packages/shared/src/permissions.ts`): `fees.manage`
(ADMIN/ACCOUNTANT ALL), `fees.read` (ADMIN/ACCOUNTANT ALL, STUDENT OWN,
GUARDIAN **CHILD** :190), `payments.initiate` (STUDENT OWN), `finance.refund`
(ADMIN/ACCOUNTANT ALL). Teachers: no finance grants at all. Guardian CHILD
reads require an ACTIVE GuardianLink (`fees.service.ts:357–369, 433–442`).

Audit actions in use: `fees.structure_created`, `fees.invoices_generated`,
`fees.invoice_cancelled`, `fees.payment_recorded`, `payments.attempt_initiated`,
`payments.settled`, `payments.attempt_failed`, `payments.webhook_rejected`,
`payments.reconciliation_verified`, `payments.refund_{requested,cancelled,
succeeded,failed}`, `exports.generated`.

Mail/notifications: `fees.listener.ts` → templates `invoice_issued`,
`invoice_overdue`, `payment_succeeded`, `payment_failed`,
`refund_succeeded`, `refund_failed` (M19-escaped chokepoint; links only —
no attachments anywhere in the mail layer).

Exports: `exports.module.ts` CSVs (students/attendance/fees/results/
refunds), ALL-scope gates, `exports.generated` audit, row cap. CSV only.

Dashboards: admin fees card (invoiced/collected(netPaid)/outstanding/
overdue) — aggregates, no documents.

## 4. Existing document capabilities

- Browser print: `@media print` in `apps/web/app/globals.css:14–27`
  (hides aside/header/.print-hide) + tailwind `print:` variants; "Print /
  Save as PDF" buttons call `window.print()`
  (`results/transcript/page.tsx:67`). COMPLETE and REUSABLE for finance.
- Server-side PDF/HTML-to-PDF: MISSING (no pdfkit/puppeteer/etc. in any
  package.json).
- File storage: M19 StoredFile (purposes COMMUNITY_ATTACHMENT/SUBMISSION/
  EVIDENCE/OTHER, schema:558–582; authz `stored-file-authz.service.ts:50–65`).
  REUSABLE but NOT REQUIRED for V1 (see §10).

## 5. Receipt discovery (classification)

| Capability | Status | Evidence |
|---|---|---|
| Payment receipts / receipt numbers / receipt records | **MISSING** | repo-wide grep: zero code hits for "receipt" outside docs |
| Printable payment confirmation | **MISSING** | no print button anywhere under `apps/web/app/(app)/fees/` |
| Refund receipts/documents | **MISSING** | same |
| Invoice PDFs / downloadable financial documents | **MISSING** | no PDF dep; exports are CSV only |
| Email receipts | **PARTIAL/REUSABLE** | `payment_succeeded` mail exists (amount+invoiceNo+link, `mail/templates.ts:197`) — an acknowledgment, not a document |
| Immutable financial-document snapshot | **MISSING** (pattern REUSABLE from M18 TermResult/CourseResult) | `results-finalization.service.ts:17–37`, schema:996–1056 |
| Payment identifiers | **PARTIAL** | invoiceNo unique/college; Payment.reference (providerRef/manual); no human receipt number |

## 6. Payment vs receipt semantics (O-1)

Traced Payment truth: a Payment row exists ONLY for settled money — manual
recording (staff-verified cash/bank/cheque/other) or provider-verified
online settlement. Attempts/pending checkouts never create Payment rows.
Therefore in CampusOS a receipt should mean: **acknowledgment of one
settled Payment row** — never an attempt, never an invoice-settlement
aggregate. Recommended cardinality: **one Payment → at most one receipt**
(`paymentId @unique` on the receipt row, mirroring `PaymentAttempt.paymentId
@unique`). Partial payments: each partial Payment gets its own receipt
showing the transaction amount; the receipt additionally snapshots
`invoiceAmount` and `balanceAfter` (computed via `netPaid()` at issuance,
under the same invoice `FOR UPDATE` discipline used everywhere else) so the
paper answers "what did this payment leave outstanding" without ever
depending on live state later. Cumulative paid is derivable and not frozen
(avoids confusion when refunds later change history — the receipt is about
the transaction, the fees page is about the balance).

## 7. Refund document semantics (O-3)

Refund rows are immutable settled money-out with partials. Recommendation:
**a refund NEVER mutates or voids a payment receipt** (the payment really
happened); each Refund row gets its **own separate immutable refund
document** (same table, `kind = REFUND`, `refundId @unique`), snapshotting
refund amount, method PROVIDER/RECORDED, reference (`refund_…` token when
present), the parent payment's receiptNo, and balance-after. Webhook
registration/replay remains **EXTERNALLY BLOCKED** (unchanged; dashboard
endpoint registration still pending — `GatewayEvent` ledger exists, 0 rows
ever) — this does NOT block refund documents because documents anchor on
the immutable Refund row, which is only created on verified truth
(reporter/RECORDED), never on webhooks.

## 8. Financial immutability analysis (O-2)

What changes under a document after issuance: invoice `status` (payments,
refunds, overdue sweep, term states), student's User names (PATCH
students), College `name` (theoretically via seed/ops), fee structure
name/components (mutable), balances (any later payment/refund). What never
changes: Payment row, Refund row, `Invoice.amount`, `Invoice.invoiceNo`.
Verdict: **B — immutable snapshot at issuance**, exactly the M18 principle
(FINALIZED HISTORICAL RECORDS MUST NOT DEPEND ON MUTABLE LIVE DATA,
`results-finalization.service.ts:17–37`). Dynamic rendering (A) would let a
2026 receipt silently change when a student is renamed or a refund lands —
unacceptable for a financial acknowledgment. The snapshot is cheap: the
core figures are already immutable; only display context (names, invoiceNo,
balance-after, college name) needs freezing — mirroring CourseResult's
denormalized `courseCode/courseTitle/credits`.

## 9. PDF architecture analysis (O-4/O-15)

Options: (A) browser print only; (B) server-side PDF (puppeteer/chromium ≈
+300 MB image, CPU spikes, sandbox/docker flags; pdfkit/pdf-lib = hand-drawn
layout duplicating the web template); (C) both; (D) email-attachment
renderer. Evaluation against this repo: reproducibility comes from the
SNAPSHOT, not the renderer (same frozen data → same figures; byte-identical
PDFs are a non-goal); authorization is enforced on the data endpoint either
way; browser print is already proven in production pages (M12/M18), needs
zero deps, zero Docker change, zero storage, zero cleanup, and is fully
testable via payload assertions; server PDF adds a renderer attack surface
(HTML injection → PDF, resource exhaustion) and operational weight with no
V1 requirement. RECOMMENDATION: **A for M20 (browser print / "Save as
PDF"), server-side PDF explicitly DEFERRED** with a clean seam: the
document payload endpoint returns the frozen snapshot; a future renderer
consumes the same payload. No package installation in M20.

## 10. StoredFile integration (O-5)

With Option A there is **no server-generated binary**, hence **no
StoredFile rows needed in M20**. Receipts are DB rows (like TermResult),
not files; access control rides PolicyService, not signed URLs. Design for
the deferred PDF future: add `FINANCE_DOCUMENT` to `FilePurpose` (enum
migration), ownership = the STUDENT user (`ownerUserId = invoice.student.
userId` when claimed, else null → college-gate only), collegeId from the
invoice; persisted once per document version; retention = permanent
(financial record). User deletion: SetNull (existing StoredFile FK
behavior) keeps the document college-accessible. None of this is built in
M20.

## 11. Authorization matrix (O-8/O-9)

Reuse existing permissions verbatim — **no new permission**:

| Actor | View/print own receipt | View any college receipt | Issue (historical) | Refund docs |
|---|---|---|---|---|
| STUDENT | fees.read OWN (own invoices only) | — | — | own payment's refund docs (fees.read OWN) |
| GUARDIAN | fees.read CHILD (ACTIVE link, explicit child, mirrors `fees.service.ts:357–369`) | — | — | CHILD |
| ACCOUNTANT | — | fees.read ALL | fees.manage ALL | fees.read ALL |
| ADMIN | — | fees.read ALL | fees.manage ALL | fees.read ALL |
| TEACHER | none (no finance grants — unchanged) | — | — | — |
| cross-college / anon | 404 / 401 | | | |

Issuance for NEW payments is automatic inside the settlement/recording
transaction (no permission question — server act). Historical/manual
issuance endpoint (backfill-on-demand, §16 W1) gated `fees.manage`.
PolicyService only; zero role-name conditionals.

## 12. Tenancy model

Receipt row carries `collegeId` (copied from `invoice.collegeId` inside
the issuing transaction — never client input). Every read filters
`{collegeId: user.collegeId}` first; OWN/CHILD scope then narrows by the
invoice's student exactly like `fees.service.ts` detail (404 on foreign or
unlinked — no existence leak). ReceiptNo uniqueness is per college
(`@@unique([collegeId, receiptNo])`), like invoiceNo.

## 13. Security threat model

| Threat | Current defense | Proposed defense | Test | WS |
|---|---|---|---|---|
| Cross-college receipt read (IDOR) | n/a | collegeId-first lookup, 404 | rival admin/student 404 | W2 |
| Cross-student receipt read | n/a | OWN/CHILD scope via invoice.student | student A vs B 403/404 | W2 |
| Predictable receipt ids | n/a | cuid PK; receiptNo is display-only, never an access key | lookup-by-id only | W2 |
| Invoice/payment id guessing | existing 404 discipline | unchanged; receipts inherit | matrix | W2 |
| Guardian bypass (no ACTIVE link) | existing CHILD gates | same explicit-child pattern | unlink → 404 | W2 |
| Accountant overreach | ALL scope is intended (finance role) | audit trail on issuance | audit assert | W2 |
| Unauthorized regeneration/mutation | n/a | receipts immutable rows; no update endpoint at all | schema/API review | W1 |
| Historical document mutation | n/a | snapshot columns; no UPDATE path; DB `paymentId @unique` | immutability e2e (edit student name → receipt unchanged) | W2 |
| Duplicate receipts (race) | n/a | insert in settlement tx + `paymentId @unique` (idempotency backstop) | concurrent issue → one row (P2002) | W1 |
| ReceiptNo collision (race) | invoiceNo count-based precedent | retry-on-P2002 allocation (see §15 — improves on invoiceNo's count approach) | parallel issuance unique | W1 |
| Refund/payment doc confusion | n/a | distinct `kind`, distinct number prefix, refund doc references parent receiptNo | payload asserts | W2 |
| HTML injection into printed page | React auto-escaping (no `dangerouslySetInnerHTML` in web) | keep JSON payload + React rendering; no HTML endpoint | hostile-name render test (payload-level) | W3 |
| PDF renderer abuse / resource exhaustion / oversized docs | n/a | NO server renderer in M20 (deferred) | n/a | deferred |
| Path traversal / arbitrary file generation | n/a | no files generated in M20 | n/a | n/a |
| Leaked signed URLs | n/a | no signed URLs used for receipts | n/a | n/a |
| Sensitive data leakage | n/a | data-minimized payload (§14) | payload field allowlist test | W2 |
| Audit spoofing | server-derived audit fields (existing) | unchanged; issuance audited in-tx | audit rows | W2 |
| Stale document serving | n/a | snapshots are intentionally frozen; UI labels issuance date + "balance as of issuance" | copy review | W3 |

## 14. Privacy / data minimization

Include on the document: college name + code; receiptNo; issuedAt; student
first/last name, admissionNo, rollNo (institutional identity — appropriate
on an institutional receipt); invoiceNo; fee-structure NAME only (frozen
string); transaction amount; method; paidAt; masked reference; invoice
amount + balance-after-issuance; refund docs add reason? — NO: refund
`reason` is internal workflow text (may reference disputes) — EXCLUDED.
Exclude: student email/phone/address, emergency-contact fields (M19-W2),
guardian identities, staff emails (show recorder's display name only —
"Received by"), full provider references (mask `refund_…`/tracker tokens to
last 6: they are capability-adjacent identifiers in provider dashboards),
gateway payloads, failureCodes, attempt history, dueDate status flags,
internal ids (cuids not printed; receiptNo/invoiceNo are the human keys).

## 15. Numbering design (O-6)

Existing: invoiceNo `INV-<year>-<seq5>` per college (count-based inside a
tx — adequate there because generation is single-flight per college
action). Receipts settle CONCURRENTLY (webhook/verify/manual), so
count-based allocation would race. Design: `RCP-<year>-<seq5>` (refund docs
`RFD-<year>-<seq5>`), unique `(collegeId, receiptNo)`; allocation =
`SELECT max(sequence) FOR UPDATE`-free optimistic insert with retry on
P2002 (bounded retries), sequence stored as `(collegeId, kind, year, seq)`
derivation from the number string is avoided by also storing `sequence Int`
frozen at issue. Application-generated (matches invoiceNo precedent; no DB
sequences per tenant exist in this repo). Immutable after issue; audited
via the issuance event.

## 16. Versioning design (O-7)

M18 needed versions because marks legitimately get corrected. Money rows
do NOT: Payment/Refund are immutable, corrections happen as new
refunds/payments, and each already yields its own document. Therefore:
**no version chain in M20** — documents are immutable forever, regenerable
displays come from re-reading the same frozen row. One escape hatch
mirrored from M18: `status ACTIVE|VOID` with a `fees.manage`-gated void
(audited, reason-required, VOID watermark on print, number never reused)
for operator-error cases (e.g., manual payment recorded on the wrong
invoice, which today is corrected by refund + re-record — the orphaned
receipt must be markable). Template/branding changes affect only future
issuances (frozen snapshot), never old documents.

## 17. Branding / template design (O-10)

College model has ONLY `name`, `code`, `settings Json` (schema:288–296;
seed `system.seed.ts:16–27`) — **no address/logo/registration fields
exist; nothing may be fabricated**. V1 receipt header = frozen
`collegeName` + `collegeCode` at issuance (snapshot columns) — live-read
would violate §8. Optional richer branding (address/logo) is a separate
future settings feature, NOT M20. No signatures/stamps (no such data);
"Received by <staff display name>" for manual payments only
(recordedById), "Online payment (verified)" for ONLINE.

## 18. Audit design (O-11)

Reuse conventions (`audit.service.ts:57–78`; `fees.*`/`payments.*`
namespaces). Required: `fees.receipt_issued` (in the issuing tx; metadata
{receiptNo, kind, paymentId|refundId}) — the financially significant
event. `fees.receipt_voided` (actor, reason). NOT audited: views/prints
(read-only, high-noise; consistent with invoice detail reads not being
audited — exports.generated audits bulk egress, a single-document read is
not bulk). Regeneration doesn't exist (no binary).

## 19. Mail / notification interaction (O-12)

Existing `payment_succeeded`/`refund_succeeded` mails already fire
exactly-once via CAS flags. M20 W3 option: append the receipt link (path
`/fees/receipts/<id>` behind login) to those existing templates — reusing
the M19-escaped chokepoint, no attachments, no new mail kinds required
(recommended: extend the two templates with one extra URL line; zero new
architecture). Automatic attachment PDFs: deferred with server PDF.

## 20. Export interaction

Receipts are DOCUMENTS, not exports. The CSV framework stays untouched; a
`receipts.csv` registry export is NOT needed in V1 (fees.csv +
refunds.csv already cover ledger egress). If later required it must join
the existing exports module — never a parallel framework.

## 21. Performance / operations

Snapshot rows are tiny (one per payment/refund; current scale trivial).
Issuance rides existing settlement/recording transactions (adds one INSERT
+ number retry loop). No storage growth beyond rows (no binaries), no
cleanup, no cache, no queue, no backup impact beyond negligible table
growth (backup sidecar unaffected). Browser print costs the client only.
No Docker changes.

## 22. Scope options

**OPTION A — Dynamic browser-print receipt page (no schema).** Render a
print view from live Payment/Invoice. + Zero migration, fastest. −
Violates M18 immutability principle (renames/refunds silently rewrite
history), no receipt number, nothing citable. Rejected.

**OPTION B — Immutable snapshot receipts + refund documents + browser
print (RECOMMENDED).** New `FinanceDocument` table (migration #14),
automatic issuance on settlement/recording/refund-success, on-demand
`fees.manage` issuance for historical rows, numbering per §15, void per
§16, payload endpoint + print page reusing the M12/M18 pattern, mail-link
extension. Schema: 1 table + 1 enum(s). Permissions: none new. Complexity:
moderate; test surface well-precedented (M16/M18 suites). Deferred: server
PDF, StoredFile purpose, branding fields, receipts.csv.

**OPTION C — Full document platform (server PDF + StoredFile persistence +
email attachments + invoice PDFs + statements).** + One-stop. − Heavy new
deps (chromium/pdf lib), renderer threat surface, storage/retention
machinery, weeks of scope, violates "minimum bounded milestone"; most value
(citable immutable receipt) already delivered by B. Rejected for M20;
natural M21+ if institutions demand true PDFs.

## 23. Recommended M20 scope

Option B. Bounded, evidence-based: anchors on already-immutable money
rows; reuses browser-print, PolicyService scopes (fees.read OWN/CHILD/ALL,
fees.manage), audit and mail conventions; one additive migration; retires
the receipts debt without touching webhooks/provider polling (EXTERNALLY
BLOCKED status unchanged).

## 24. W1–W4 implementation plan

- **W1 — Data model + issuance engine.** Migration #14: `FinanceDocument`
  (id cuid, collegeId, kind PAYMENT_RECEIPT|REFUND_DOCUMENT, receiptNo,
  sequence, year, status ACTIVE|VOID, paymentId? @unique, refundId?
  @unique, invoiceId, frozen: studentName, admissionNo, rollNo, invoiceNo,
  structureName, collegeName, collegeCode, amount, method, reference
  (masked), paidAt/refundedAt, invoiceAmount, balanceAfter, receivedByName?,
  parentReceiptNo? (refund docs), issuedById?, issuedAt, voidedById?,
  voidedAt?, voidReason?; `@@unique([collegeId, receiptNo])`). Issuance
  service (in-tx for new settlement/manual/refund paths; retry-on-P2002
  numbering; `paymentId/refundId @unique` idempotency), historical
  issue-on-demand endpoint (`fees.manage`). NO backfill migration (docs
  issued on demand — nothing derivable is fabricated). Tests: issuance on
  all three money paths, duplicate/concurrent idempotency, numbering
  uniqueness under parallelism, CLOSED-term independence. STOP: suite
  green.
- **W2 — Read API + authorization + security matrix.** GET
  `fees/receipts` (scoped list), GET `fees/receipts/:id` (payload), POST
  `fees/receipts/:id/void` (`fees.manage`, reason, audit). Full matrix
  tests (OWN/CHILD/ALL/teacher-none/cross-college-404/anon-401),
  immutability proof (rename student → document unchanged), refund-doc
  linkage, payload field-allowlist (privacy §14). STOP: matrix green.
- **W3 — UI/print + mail links.** `/fees/receipts/[id]` print page
  (globals.css pattern, `.print-hide`, VOID watermark), buttons on invoice
  detail (per payment/refund row) + student/guardian fees views;
  `payment_succeeded`/`refund_succeeded` templates gain the receipt URL
  line (chokepoint-escaped). Playwright/print smoke + hostile-name render.
  STOP: UI verified via preview.
- **W4 — Hardening/close-out.** Security re-audit, OPERATIONS runbook §29
  (issuance, numbering, void policy, never-do list), history/debt-register
  close (receipts debt → resolved-with-evidence), full regression. STOP:
  M20 CLOSED report.

Each WS: one commit → push → report → STOP.

## 25. Open decisions (need approval before W1)

- **O-1 Receipt definition**: one immutable document per settled Payment
  row (transaction-level). RECOMMENDED (§6). Blocks W1.
- **O-2 Snapshot vs dynamic**: immutable snapshot at issuance. RECOMMENDED
  (§8). Blocks W1.
- **O-3 Refund documents**: separate immutable REFUND_DOCUMENT per Refund;
  never mutates the payment receipt. RECOMMENDED (§7). Blocks W1.
- **O-4 PDF strategy**: browser print only. RECOMMENDED (§9). Blocks W3.
- **O-5 StoredFile**: not used in M20 (no binaries); `FINANCE_DOCUMENT`
  purpose deferred with server PDF. RECOMMENDED (§10). Blocks nothing.
- **O-6 Numbering**: `RCP-/RFD-<year>-<seq5>` per college, stored
  sequence, retry-on-unique. RECOMMENDED (§15). Blocks W1.
- **O-7 Versioning**: none; ACTIVE|VOID only (audited void, reason,
  watermark). RECOMMENDED (§16). Blocks W1.
- **O-8 Authorization**: reuse fees.read (OWN/CHILD/ALL) + fees.manage; no
  new permission. RECOMMENDED (§11). Blocks W2.
- **O-9 Guardian access**: yes, CHILD scope, ACTIVE-link gate as in fees
  detail. RECOMMENDED. Blocks W2.
- **O-10 Branding**: freeze collegeName/code only; no fabricated
  address/logo; richer branding = future settings work. RECOMMENDED (§17).
  Blocks W1 column list.
- **O-11 Audit**: `fees.receipt_issued` + `fees.receipt_voided`; reads not
  audited. RECOMMENDED (§18). Blocks W1/W2.
- **O-12 Mail**: extend existing payment/refund success templates with the
  receipt link; no new kinds, no attachments. RECOMMENDED (§19). Blocks W3.
- **O-13 Retention**: permanent (financial records; no deletion path).
  RECOMMENDED. Blocks nothing.
- **O-14 Regeneration**: n/a — display re-reads the frozen row; no binary
  regeneration exists. RECOMMENDED. Blocks nothing.
- **O-15 Server-side PDF required?**: NO for M20 — deferred with a clean
  payload seam. RECOMMENDED (§9). Blocks nothing.

## 26. Dependencies / blockers

- Safepay webhook registration/replay: **EXTERNALLY BLOCKED** (unchanged;
  not needed — documents anchor on verified Payment/Refund rows).
- Provider polling: DEFERRED (unchanged; unrelated).
- M19 StoredFile: available, NON-BLOCKING (unused in V1).
- Finance permissions/policy: available, NON-BLOCKING.
- Audit framework, mail chokepoint, browser print, exports: available,
  NON-BLOCKING.
- Server PDF, external monitoring, off-host backups, PITR: DEFERRED
  (unchanged).
- **BLOCKING**: only the O-1…O-11 approvals above.

## 27. Deferred items (verbatim, unchanged)

Off-host backup copies; PITR; external SaaS monitoring; distributed/shared
rate limiter; Safepay webhook registration/replay (EXTERNALLY BLOCKED);
per-college webhook secrets; provider polling; maker-checker; GPA
scale/repeat-course/rank policy; Prisma upgrade; FILE_URL_SECRET rotation.
M20 adds deferred: server-side PDF rendering; StoredFile FINANCE_DOCUMENT
purpose; college branding fields; receipts.csv export; mail attachments.

## 28. Acceptance criteria for M20

Every settled payment and refund acquires exactly one immutable, uniquely
numbered, college-scoped document; documents render printable via the
existing pattern; OWN/CHILD/ALL matrix enforced with 404 tenancy; void is
the only state change and is audited; student rename/refund/term events
never alter an issued document; zero new permissions; zero role
conditionals; migration count 13→14; full suite green; demo accounts
unaffected.

## 29. Discovery evidence / source map

`apps/api/prisma/schema.prisma` (:288, :996–1056, :1077–1298);
`apps/api/src/fees/{fees.service.ts,fees.controller.ts,money.ts}`;
`apps/api/src/payments/{payments.service.ts,refunds.service.ts,
payments.controller.ts,refunds.controller.ts,payments-webhook.controller.ts,
safepay.adapter.ts}`; `apps/api/src/exports/exports.module.ts`;
`apps/api/src/exams/results-finalization.service.ts`;
`apps/api/src/files/stored-file-authz.service.ts`;
`apps/api/src/audit/audit.service.ts`;
`apps/api/src/notifications/listeners/fees.listener.ts`;
`apps/api/src/mail/templates.ts`; `packages/shared/src/permissions.ts`;
`apps/web/app/globals.css:14–27`; `apps/web/app/(app)/fees/**`;
`apps/web/app/(app)/results/transcript/page.tsx`; test suites
`fees|payments-*|refund*|exports|guardian-child-data` in `apps/api/test/`.

## 30. STOP conditions for W1

Do not start W1 without explicit authorization + O-1/O-2/O-3/O-6/O-7/O-10/
O-11 decisions. W1 stops after: migration #14 + issuance engine + tests
green + one commit. Any need for a new permission, a PDF dependency, a
StoredFile change, or webhook work = STOP and report (out of approved
design).
