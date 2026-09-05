# M16 Refunds & Accountant — Design Specification

## 1. Status and scope

This is the committed source-of-truth design for M16 (Refunds + Accountant
role), produced by **M16-W0** (provider probe + design; no product code).
Labels used throughout: **VERIFIED** (established from source or live
sandbox behavior), **UNVERIFIED** (not established), **DECISION** (locked
product choice D-1…D-8), **PROPOSAL** (implementation recommendation
subject to later technical discovery).

## 2. Baseline at M15 close

VERIFIED at W0 start: HEAD `229d522`, branch
`amjad-ali-s/set-up-this-codebase-for-6iTTUe`, clean tree, 461/461 tests
(35 suites), typecheck 0, API/web production builds green, 9 migrations
("Database schema is up to date"), Docker stack healthy. No
Refund/RefundAttempt models, no refund endpoints, no ACCOUNTANT role
exist anywhere; the only refund artifacts are the reserved
`PaymentAttemptStatus.REFUNDED` enum value and webhook refund event types
recorded as `OTHER` in `GatewayEvent`.

## 3. Locked product decisions D-1 through D-8 (DECISION)

| # | Decision |
|---|---|
| D-1 | Refund initiators: ADMIN + ACCOUNTANT, both via new `finance.refund`. Accountant is finance-only; admin keeps broad capabilities. |
| D-2 | Single-step refunds in V1. No maker-checker, no `finance.refund.approve`. |
| D-3 | No self-refund block (a user may refund a payment they recorded). Auditability is the control. |
| D-4 | Partial refunds REQUIRED. Full refund = amount == remaining refundable. No mode flag. |
| D-5 | Invoice status derived from net paid = settled payments − settled refunds. Net 0 → PENDING. Never toggled manually. |
| D-6 | ACCOUNTANT receives full `audit.read`. |
| D-7 | Refunds allowed against payments of CANCELLED invoices. |
| D-8 | `PaymentAttemptStatus.REFUNDED` stays UNUSED in V1. Refund state lives on RefundAttempt; UI derives display state from Refund/RefundAttempt data. |

## 4. W0 Safepay probe results

Probe performed 2026-08-26 against the real Safepay **sandbox** with the
already-configured merchant credentials (secrets never printed/committed).
A fresh sandbox payment was created through the normal CampusOS checkout
flow (test card 4456 5300 0000 1005), settled at PKR 800.00
(`TRACKER_ENDED`, tracker `track_048aa32c-…b4ef08`), then refunded. The
probe payment/attempt rows were removed from the demo database afterwards
(provider-side sandbox test money only).

**VERIFIED provider facts:**

- **Refund API exists and works for this merchant.**
  `POST {host}/order/payments/v3/{tracker}/refund` (path confirmed both in
  the `@sfpy/node-core` v0.3.5 SDK source, `Order/Cancel.js`, and live).
- **Auth:** the same `x-sfpy-merchant-secret` header the existing adapter
  uses works for refunds (the docs example shows JWT auth; secret auth is
  LIVE-VERIFIED).
- **Request body:** `{ "currency": "PKR", "amount": <integer, lowest
  denomination (paisa)> }`. LIVE-VERIFIED: `amount: 30000` refunded
  PKR 300.00.
- **Partial refunds supported**, unlimited count until exhausted
  (docs + LIVE-VERIFIED: 300 then 500 on an 800 payment).
- **Synchronous execution.** The HTTP 200 response already carries the
  post-refund tracker state — no pending/async refund state was observed.
- **Response shape:** `{ data: { tracker: {...state...}, action:
  { cybersource_refund: {...} } }, status: { errors: [], message:
  "success" } }`.
- **States:** partial → `TRACKER_PARTIAL_REFUND`; fully refunded →
  `TRACKER_REFUNDED` (both LIVE-VERIFIED on the tracker and via the
  reporter afterwards).
- **Provider refund identifier:** each refund creates a token of the form
  `refund_<uuid>` visible in the reporter's
  `data.charge.cybersource_refunds[]` array together with its amount.
  LIVE-VERIFIED: two entries (`30000`, `50000`).
- **Verification after submission:** the existing reporter endpoint
  `GET /reporter/api/v1/payments/{tracker}` reflects refund state,
  `charge.balance` (`80000 → 0`), and the refunds array; the tracker's
  `events` list gains `REFUND` entries (`ENROLLMENT, AUTHORIZATION,
  CAPTURE, REFUND, REFUND` observed). There is no separate
  refund-status endpoint; the payment reporter is the status surface.
- **Over-refund rejected provider-side:** requesting 90000 against a
  remaining 50000 → HTTP 400,
  `"refund amount (900.00) is higher than remaining balance (500.00)"`.
  The provider tracks remaining balance itself.
- **Already-fully-refunded rejected:** HTTP 400,
  `"cannot refund tracker in state TRACKER_REFUNDED"`.
- **Invalid tracker:** HTTP **500**, `"cannot find tracker with token …"`
  (note: 500, not 404 — the adapter must treat non-2xx uniformly, as it
  already does).
- **Fees visibility:** the reporter's `charge` block exposes
  `fees` / `tax` / `net` / `withholding_tax` (observed: fees 5068 paisa on
  the 80000 charge). No *additional* fee appeared on the charge after the
  refunds.

**UNVERIFIED PROVIDER BEHAVIOR:**

- Whether refund **fees are charged to the merchant** (or the original fee
  refunded) in production; sandbox showed no visible extra charge.
- Refund **timeout/network mid-flight semantics** (whether a dropped
  connection can leave a refund applied server-side; assume YES for
  design purposes — hence verify-based recovery).
- **Duplicate concurrent refund requests** at the provider (two identical
  in-flight POSTs). Not probed to avoid racing test infrastructure;
  CampusOS prevents this client-side by design (§12) regardless.
- Refund **webhooooks**: event names/shapes for refunds, delivery, replay
  cadence. `payment.refunded`-style types are implied by the webhook docs
  but NOT verified (see §4a).
- Production **limits / merchant-tier restrictions**; card refunds
  documented as available up to 90 days post-transaction (docs statement,
  not sandbox-verifiable).
- Reversal (`/reversal`, <24 h) and void endpoints exist in the SDK —
  intentionally out of M16 scope.

### 4a. Webhook registration attempt (operations)

Registration remains **externally blocked**: Safepay exposes webhook
endpoint registration only through the merchant dashboard
(`sandbox.api.getsafepay.com/dashboard` — reachable), for which the
project has **no dashboard login credentials** (only API key material is
configured), and the sandbox has no public HTTPS endpoint to register.
The `@sfpy/node-core` SDK exposes no webhook-registration API. VERIFIED:
zero `GatewayEvent` rows exist after the two live refunds — no webhook
deliveries occur (nothing is registered). **Webhook verification is NOT
complete and is not claimed to be.** Refund correctness therefore must
not depend on webhooks (§26).

## 5. Verified vs unverified provider behavior (summary table)

| Aspect | Status |
|---|---|
| Refund endpoint/method/body/auth | VERIFIED |
| Paisa (lowest denomination) amounts | VERIFIED |
| Partial refunds, unlimited until exhausted | VERIFIED |
| Synchronous result + states | VERIFIED |
| `refund_<uuid>` identifiers via reporter | VERIFIED |
| Provider-side over-refund/full-refund guards | VERIFIED |
| Verification via payment reporter | VERIFIED |
| Refund webhooks (names/shape/delivery) | UNVERIFIED |
| Refund fees in production | UNVERIFIED |
| Timeout mid-flight semantics | UNVERIFIED (assume applied; recover via verify) |
| Limits/tier restrictions | UNVERIFIED (90-day card window per docs) |

**W3 provider execution: GO** — the contract is verified end to end.

### 5a. M16-W3 live end-to-end verification (2026-08-26)

The SHIPPED W2 implementation (not a probe script) was exercised against
the real Safepay sandbox through the normal app path: fresh PKR 800.00
checkout payment settled (`TRACKER_ENDED`), then, via
`POST /fees/payments/:id/refunds` + `…/execute` as the demo accountant:

- **VERIFIED**: PROVIDER refund of PKR 300.00 → attempt SUCCEEDED with a
  real `refund_…` reference; exactly one Refund row (300.00); invoice
  PARTIAL; summary refundable 500.00; exactly one
  `payments.refund_succeeded` audit row and one `refund.succeeded`
  notification. The provider reporter independently showed
  `TRACKER_PARTIAL_REFUND`, balance 50000 paisa, one 30000-paisa refund
  whose ref equals the stored `providerRefundRef`.
- **VERIFIED**: `…/verify` on the terminal attempt is idempotent (two
  replays: no duplicate Refund/audit/notification, attempt stays
  SUCCEEDED).
- **VERIFIED**: second refund of PKR 500.00 → Σ refunds = 800.00,
  refundable 0.00, provider `TRACKER_REFUNDED` with balance 0 and two
  refund records; Payment amount unchanged (800.00); PaymentAttempt
  frozen fields unchanged; Invoice.amount unchanged; net-paid formula
  held (other net paid 700/1500 → invoice correctly PARTIAL; the
  net-0→PENDING branch is proven by the W2 e2e suite).
- **VERIFIED**: post-exhaustion refund of PKR 0.01 → 400
  `EXCEEDS_REFUNDABLE` at creation, zero rows/side effects, no provider
  call (creation never touches the adapter).
- **No implementation defects found; zero hardening changes required.**
  Probe data was removed and the demo database restored to its exact
  pre-probe state (the sandbox tracker remains refunded, as in W0).
  Still UNVERIFIED: refund webhooks (delivery unregistered), production
  fees/limits, provider-side concurrent duplicates, true network-timeout
  mid-flight semantics (the recovery path was exercised only via the W2
  fake-gateway tests).

## 6. Recorded/manual refund architecture

CORE PRINCIPLE (DECISION): recorded refunds work with zero provider
dependency. For CASH/BANK money returned by staff out-of-band:
staff confirms the money was returned → a REQUESTED RefundAttempt with
`method: RECORDED` transitions directly to SUCCEEDED in one transaction,
materializing the immutable `Refund` row. No provider call, full audit
trail, same money invariants. This is the guaranteed V1 path even if
provider refunds were unavailable.

## 7. Provider refund architecture

For ONLINE payments (`method: PROVIDER`): extend `PaymentGatewayAdapter`
(PROPOSAL):

```ts
createRefund(input: { providerRef: string; amount: string; currency: string }):
  Promise<{ state: 'REFUNDED' | 'PARTIALLY_REFUNDED'; }>;
verifyRefunds(providerRef: string):
  Promise<{ state: string; refunds: Array<{ ref: string; amount: string }>; balance: string }>;
```

The Safepay implementation calls the verified endpoints above, converting
amounts with the existing `toLowestDenomination`/`fromLowestDenomination`
helpers. `providerRefundRef` is captured from
`charge.cybersource_refunds[]` via `verifyRefunds` (the refund POST
response exposes the action object; the reporter is the canonical
identifier source). Tests inject a capturing fake via the existing
`PAYMENT_GATEWAY` token. Client input is never provider truth.

## 8. Refund domain model

`Refund` — settled money-out ledger, **immutable after creation**, source
of truth for money actually returned:

| Field | Notes |
|---|---|
| id | cuid |
| paymentId | FK → Payment, `onDelete: Restrict` |
| invoiceId | FK → Invoice, Restrict (denormalized for listings) |
| amount | Decimal(10,2) |
| method | RECORDED \| PROVIDER (mirrors how money went back) |
| reference | provider refund ref (`refund_…`) or staff memo |
| refundedAt | DateTime |
| recordedById | FK → User, nullable (null = provider-confirmed path) |
| createdAt/updatedAt | timestamps |

## 9. RefundAttempt domain model

Lifecycle/state machine (analog of PaymentAttempt):

| Field | Notes |
|---|---|
| id, collegeId | tenancy belt independent of joins |
| paymentId, invoiceId | FKs, Restrict |
| amount, currency ("PKR" V1) | frozen server-side at creation |
| reason | required short text (stored here, NOT in audit metadata) |
| method | PROVIDER \| RECORDED |
| provider, providerRefundRef | nullable; `@@unique([provider, providerRefundRef])` |
| status | REQUESTED \| PROCESSING \| SUCCEEDED \| FAILED \| CANCELLED |
| failureCode | nullable |
| requestedById | FK → User |
| confirmedAt | nullable |
| refundId | `@unique`, set on SUCCEEDED |
| createdAt/updatedAt | timestamps |

Indexes: `@@index([collegeId, status])`, `@@index([paymentId])`,
`@@index([invoiceId])`. Partial unique (raw SQL, M15 precedent):
one in-flight attempt per payment —
`UNIQUE ON RefundAttempt(paymentId) WHERE status IN ('REQUESTED','PROCESSING')`.

## 10. State machine

```
REQUESTED ──execute (PROVIDER call)──▶ PROCESSING ──▶ SUCCEEDED (terminal)
    │                                       └────────▶ FAILED    (terminal)
    ├──cancel──▶ CANCELLED (terminal)
    └──confirm (RECORDED only)──▶ SUCCEEDED
```

- No backward transitions. No PROCESSING → CANCELLED (money may be
  moving; resolve via verify). FAILED/SUCCEEDED/CANCELLED are terminal.
- Every transition is a CAS (`updateMany where status = <expected>`);
  replays and races are no-ops with a `justSucceeded`-style flag for
  exactly-once notifications (mirrors `settleAttempt`/`failAttempt`).
- SUCCEEDED for PROVIDER attempts requires provider confirmation: the
  synchronous refund response and/or `verifyRefunds` — never client input.
- Retry after FAILED = a **new** attempt (terminal rows immutable).
- A stuck PROCESSING attempt is resolved by the reconciliation Verify
  action (reporter truth), never by TTL expiry.

## 11. Money invariants

- All CampusOS amounts remain Decimal(10,2) PKR; paisa integers exist
  only inside the adapter boundary (VERIFIED conversion helpers reused).
- amount must be > 0 (shared Zod), currency must equal the payment's.
- Provider-confirmed amounts are compared against the frozen attempt
  amount with the same normalized `toFixed(2)` equality used by
  settlement; mismatch → FAILED `AMOUNT_MISMATCH`.
- FINANCIAL IMMUTABILITY — never mutate: Payment.amount/method/
  reference/paidAt; PaymentAttempt.amount/providerRef/confirmedAt;
  Invoice.amount/invoiceNo. Only derived Invoice.status is recomputed.

## 12. Over-refund and concurrency invariants

`refundable = payment.amount − Σ Refund.amount(paymentId)` — recomputed
**at creation AND immediately before execution**, inside the transaction
holding `SELECT … FOR UPDATE` on the **Invoice row** (the same lock that
serializes settlement and manual recording, so refunds also serialize
against incoming money). CAS on attempt status; DB partial unique makes
concurrent duplicate creation collapse to exactly one (the loser gets 409
`REFUND_IN_PROGRESS`). Worked example: payment 800, refund 300 succeeded,
two concurrent 400s → one blocked by the in-flight unique; retried after
the winner completes → `EXCEEDS_REFUNDABLE` (remaining 100). The provider
enforces the same bound independently (VERIFIED) — defense in depth, but
CampusOS never relies on it.

## 13. Invoice net-of-refund accounting (DECISION D-5)

`netPaid = Σ Payment.amount − Σ Refund.amount` per invoice.
Status: netPaid == 0 → PENDING; 0 < netPaid < invoice.amount → PARTIAL;
netPaid ≥ invoice.amount → PAID. OVERDUE remains the lazy transition for
past-due PENDING/PARTIAL invoices (a refund that drops a PAID invoice
below full re-enters that pool naturally); CANCELLED is unaffected by
refunds (D-7 allows refunding its payments; its status stays CANCELLED).
Implementation blast radius (all must change together in W2):
`paidAmount()` and summary in `fees.service.ts`, the balance reducers in
`payments.service.ts` (`createAttempt`, `settleAttempt`), and the
status-write sites. Recompute happens only inside invoice-locked
transactions.

## 14. PaymentAttemptStatus.REFUNDED decision (DECISION D-8)

Remains unused in V1. Refund state lives exclusively on
RefundAttempt/Refund; any UI badge (e.g. "Refunded" on a payment row)
derives from `Σ refunds == payment.amount`.

## 15. Accountant role and permission model

- Migration #10 adds `ACCOUNTANT` to the `RoleKey` Prisma enum (same
  migration as the refund tables) and a `finance.refund` permission.
- Grants (shared `ROLE_PERMISSION_MATRIX` + system seed):
  `fees.read` (ALL), `fees.manage` (ALL) — brings invoices, manual
  payments, reconciliation, exports; `users.read` (ALL); `audit.read`
  (ALL, D-6); `finance.refund` (ALL); plus `dashboard.admin`? — NO:
  PROPOSAL: accountant lands on `/fees` (`homeUrl` semantics in web nav);
  no dashboard permission beyond what fees pages need.
- ADMIN also receives `finance.refund` (D-1).
- Explicitly NOT granted: `academics.manage`, `users.manage`,
  `settings.manage`, `moderation.act`, `verification.manage`,
  `announcements.create`, enrollment/timetable/marks permissions.
- No role-name conditionals anywhere; PolicyService/`@RequirePermission`
  only. Demo seed adds `accountant@campusos.dev`.

## 16. Authorization and tenancy rules

- All refund mutations: `@RequirePermission('finance.refund')` with
  resolved scope ALL; listings under `fees.manage` ALL (reconciliation
  precedent).
- Payment resolved by `findFirst({ id, invoice: { collegeId:
  user.collegeId } })` → cross-tenant is 404. RefundAttempt carries its
  own collegeId belt; provider refs are written only from adapter
  responses; `invoiceId` is derived from the payment server-side, never
  accepted from the client. Plan/ids revalidated inside the transaction.

## 17. Audit events

`payments.refund_requested`, `payments.refund_succeeded`,
`payments.refund_failed`, `payments.refund_cancelled` — metadata is
ids/amounts/failureCode only (no student PII, no reason text, no provider
secrets), matching the `payments.settled` precedent. Exactly one audit
row per real transition (CAS-guarded).

## 18. Notifications

Events (existing `EventsService` pattern, emitted after commit): student
(+ linked guardians via existing guardian fan-out) on refund succeeded
and failed; staff notification on PROVIDER failure. Exactly-once via the
`justSucceeded/justFailed` transition flags. No duplicates on
replay/verify.

## 19. API contract (PROPOSAL)

| Endpoint | Permission | Behavior |
|---|---|---|
| `POST /fees/payments/:paymentId/refunds` `{amount, reason, method}` | finance.refund | creates REQUESTED attempt (RECORDED confirms immediately → SUCCEEDED); 404 foreign, 400 zero/negative/exceeds, 409 in-flight |
| `POST /fees/refunds/:id/execute` | finance.refund | PROVIDER only: CAS REQUESTED→PROCESSING, adapter call, → SUCCEEDED/FAILED |
| `POST /fees/refunds/:id/cancel` | finance.refund | CAS REQUESTED→CANCELLED |
| `GET /fees/payments/:paymentId/refunds` | fees.read (staff ALL / OWN student read-only) | history + remaining refundable |
| `GET /payments/reconciliation/refunds` | fees.manage ALL | in-flight/failed refunds list |
| `POST /payments/reconciliation/refunds/:id/verify` | fees.manage ALL | reporter truth → route through the same CAS core |

`{data}/{error}` envelopes and shared Zod schemas in
`packages/shared` as everywhere else.

## 20. UI/UX contract (PROPOSAL)

Refund action on staff invoice-detail payment rows; dialog shows payment
facts, prior refunds, server-computed remaining refundable, amount input
prefilled with the full remaining amount (partial = edit down), required
reason, typed amount confirmation (rollover pattern), busy-guarded
submit. Reconciliation gains a **Refunds** sub-tab (status badges, Verify
button, failureCode). Invoice detail shows immutable refund history and
net totals; students/guardians see refunds read-only on their invoices.
Accountant journey: login → fees; nav is permission-driven (no new
mechanism).

## 21. Reconciliation model

Refund attempts appear in reconciliation exactly like payment attempts:
PROCESSING rows are actionable via Verify (reporter is truth,
VERIFIED §4); terminal rows are display-only. `GatewayEvent` continues to
record any webhook deliveries (including refund events if ever
registered) idempotently; a claimed refund event routes into the same CAS
transition core and can never double-apply.

## 22. Failure/retry/idempotency behavior

- Adapter/network failure during execute: attempt stays PROCESSING;
  operator verifies (reporter shows whether the refund applied — the
  UNVERIFIED timeout case is safe under this recovery either way).
- Provider 400 (over-refund/state): CAS → FAILED + failureCode; retry =
  new attempt.
- Duplicate submits: in-flight partial unique → 409.
- Replayed confirmations/verifies: CAS no-ops, single Refund row, single
  notification.
- Terminal attempts are never resurrected (payments precedent).

## 23. Security/adversarial test matrix (W2 requirement)

AUTH: admin ✓, accountant ✓, teacher/student/guardian 403, anon 401 on
every surface. TENANCY: rival-college payment/refund ids → 404, rival
admin can't see/cancel/verify ours, foreign ids in bodies rejected.
AMOUNTS: full; partial; second partial to exact remaining; zero/negative
400; > payment 400; > remaining 400. CONCURRENCY: simultaneous creates →
one 201/one 409; concurrent execute → CAS single winner; retry-after-
FAILED fresh attempt succeeds. STATE: execute/cancel on terminal → 409;
already-fully-refunded → 400; refund on CANCELLED invoice's payment
allowed (D-7). MONEY: paisa conversion vectors; currency mismatch;
invoice recompute PAID→PARTIAL→PENDING; OVERDUE interaction. SECURITY:
forged/ignored client provider refs; tampered amounts vs frozen attempt;
unauthorized roles; audit hygiene (ids/amounts only). PROVIDER (fake):
success, decline, timeout-stays-PROCESSING + verify recovery, garbage
response, duplicate confirmation replay. NOTIFICATIONS: exactly-once per
transition, correct recipients (student, guardians, staff-on-failure).

## 24. Migration plan

One migration (#10) in W1: `Refund` + `RefundAttempt` tables (+ raw-SQL
partial unique index, M15 precedent), `RefundAttemptStatus` enum,
`ALTER TYPE "RoleKey" ADD VALUE 'ACCOUNTANT'`, `finance.refund`
permission seeding via the existing system seed. No changes to Payment,
PaymentAttempt, Invoice columns. Verify `migrate status` = 10 and seed
idempotency on the existing database.

## 25. Workstream plan

| WS | Scope | Excluded |
|---|---|---|
| **W0** (this) | Provider probe + this design document | any product code |
| **W1** | Prisma schema + migration #10 + ACCOUNTANT role + `finance.refund` + shared schemas/types + seeds (incl. demo accountant) | refund service/endpoints |
| **W2** | RefundsService + endpoints + RECORDED refunds end-to-end + fake-adapter PROVIDER flow + net-of-refunds accounting + audit + notifications + full adversarial suite | real Safepay calls, UI |
| **W3** | Safepay adapter `createRefund`/`verifyRefunds` + live sandbox verification (GO per §5) | webhook registration |
| **W4** | Refund UI + reconciliation Refunds tab + accountant journey + student/guardian read-only visibility + Alloy walkthrough (demo data restored) | new design-system components |
| **W5** | Hardening + refund CSV + OPERATIONS runbook + security re-audit + history + close-out | anything in §28 |

Every workstream: ONE commit, push, report, STOP.

## 26. Provider dependency boundary

Recorded refunds have zero provider dependency and are the guaranteed V1
path. Provider execution is an optional adapter capability behind the
`PAYMENT_GATEWAY` token; if Safepay were unavailable the domain model,
accounting, UI and tests are unchanged (ONLINE payments would be refunded
as RECORDED after a manual bank transfer). Webhooks remain
correctness-irrelevant: they are recorded and reconciled if ever
delivered, but verify-is-truth (M14 model) governs.

## 27. Operational risks

1. Net-of-refunds recompute blast radius (§13) — must land as one
   reviewed change with regression tests.
2. `ALTER TYPE … ADD VALUE` enum migration semantics on Postgres 16 —
   validate in W1 (Prisma handles it; check transactional behavior).
3. UNVERIFIED production refund fees/limits — confirm at merchant
   onboarding; does not affect correctness.
4. Refund webhooks unregistered (externally blocked, §4a) — PROCESSING
   recovery relies on the Verify action; documented in the W5 runbook.
5. Sandbox restarts wipe untracked `apps/api/.env` — W3 live verification
   depends on the operator-provided sandbox credentials being present.

## 28. Explicit non-goals / deferred items

Maker-checker approval; `finance.refund.approve`; self-refund blocks;
automatic provider polling; refund receipts/PDFs (document system is a
later milestone); refund webhooks registration/replay testing (externally
blocked; status unchanged); reversal (<24 h) and void operations; term
freeze (D6 of M15, unchanged); P2-IDOR-1 (unchanged); per-college webhook
secrets (unchanged); merchant/provider production questions (fees,
limits, settlement timing — record at onboarding); any M17+ work.
