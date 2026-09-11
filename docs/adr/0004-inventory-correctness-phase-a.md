# ADR-0004: Inventory correctness (Phase A) — available stock, idempotency, requisition concurrency

## Status
Accepted (2026-09-11)

## Context
Milestone-1/2 schema (ADR-0002) built the storekeeper walking skeleton
without three things a real store loop needs once it carries real
material: a way to know how much stock is actually available before
letting an Issue happen, a way to survive a retried request (network
timeout, double-tap) without double-posting a ledger row, and a way to
stop two concurrent requisition issues from over-issuing the same line.
This ADR covers the three decisions approved for Phase A, plus the
alternatives considered and rejected.

## 1. Available stock

### Options
1. **StockMovement remains the sole source of truth.** Available =
   SUM(RECEIPT) − SUM(ISSUE), computed on read. No new table.
2. **Add a `StockBalance` table** (one row per tenant/site/material,
   updated on every movement). O(1) read instead of an aggregate query.

### Decision
Option 1. `StockService.getAvailableQuantity()` is the single place this
is computed; both the direct Store Out path and the requisition-issue path
call into it.

## 2. Idempotency

### Options
1. **Client-generated UUID key + DB unique constraint**, scoped
   `@@unique([tenantId, idempotencyKey])` on `StockMovement`.
2. Server-generated dedup key derived from request content (hash of
   payload). Doesn't require the client to generate anything, but can't
   distinguish "the same edit resubmitted" from "coincidentally identical
   values submitted twice on purpose."

### Decision
Option 1.
- Same tenant + same key + same logical request (site/material/quantity/
  movement type match) → replay: returns the original row, does not
  insert a second one.
- Same tenant + same key + a materially different request → conflict
  (`ConflictException`), not a silent replay of stale data. A reused key
  across two different requests is a client bug worth surfacing loudly,
  not papering over.
- Different tenants may reuse the same key independently — the constraint
  is scoped by `tenantId`, so this is a non-event, not a special case.
- Requisition issue derives one key per line (`${requestKey}:${lineId}`)
  from a single request-level key, since one multi-line submit produces
  one `StockMovement` per line.

## 3. Requisition concurrency

### Options
1. **Row-level locking**: `SELECT ... FOR UPDATE` on the relevant
   `RequisitionLine` rows before computing "remaining to issue", inside
   the same transaction that inserts the resulting `StockMovement` rows.
2. **SERIALIZABLE isolation + retry** on every requisition-issue
   transaction.

### Decision
Option 1.
- Line IDs are deduplicated and sorted before locking, and locked in one
  combined `SELECT ... FOR UPDATE WHERE id = ANY(sorted) AND
  "requisitionId" = :id` — deterministic order (no two callers can
  acquire the same two locks in opposite order → no deadlock), and scoped
  to the requisition being issued so a client-supplied line ID belonging
  to a different requisition is never locked at all.
- The entire multi-line issue (lock → per-line check-and-insert → final
  status update) runs inside one `prisma.$transaction`. A failure on any
  line rolls back every line in that call — no partial issue survives a
  rejected request.

## 4. Direct Store Out concurrency — deferred, not decided here

Direct Store Out (no requisition involved) has no equivalent lock: the
ledger is append-only, so there is no row representing "current stock"
for a lock to be taken on. Under Postgres's default Read Committed
isolation, two concurrent direct Store Outs against the same material can
both read the same available quantity before either commits, and both
pass the check — a real, reproducible race (forced deterministically in
`stock.service.spec.ts`'s "KNOWN LIMITATION" test).

This is **not fixed in Phase A**. Candidate mechanisms for a future ADR,
not decided or implemented here:
- `pg_advisory_xact_lock` keyed on `hashtext(tenantId||siteId||materialId)`
  — cheapest, no schema change, needs a collision-rate judgment call.
- SERIALIZABLE isolation + retry on `recordIssue` specifically (not
  adopted as the default for requisition issue — see below — but could be
  scoped narrowly to just this path).
- A dedicated, deliberately mutable `stock_balance` row, locked via
  `SELECT ... FOR UPDATE` the same way `RequisitionLine` is. Would need
  its own ADR before touching the schema — it reintroduces a stored,
  cacheable total the append-only-ledger rule was written to avoid.

## Alternatives considered and rejected

- **`StockBalance` as the source of truth for available stock** (rejected
  under §1): a stored, updated-on-every-movement balance is exactly the
  "mutable quantity" shape the schema foundations rule forbids — "how did
  this material disappear?" must always be answerable from the ledger
  alone, and a cached balance can drift from it.
- **SERIALIZABLE + retry as the default requisition-issue strategy**
  (rejected under §3): correct, but every caller would need a retry loop,
  and it causes more aborts under contention than row-level locking on
  the specific rows actually in play. Row-level locking is the more
  targeted fix for a mechanism (requisition lines) that already has a
  real row to lock.
- **Any broader rebuild of the stock/requisition data model** to
  accommodate these decisions: not required — all three fit inside the
  existing `StockMovement`/`Requisition`/`RequisitionLine` shape from
  ADR-0002 with one additive column (`idempotencyKey`) and no other
  schema change.

## Consequences
- `StockMovement` gains `idempotencyKey String?` +
  `@@unique([tenantId, idempotencyKey])` (migration
  `20260911151554_stock_movement_idempotency_key`).
- Every write path that can be retried (Store In, Store Out, requisition
  issue) must generate and pass an idempotency key from the client to get
  replay-safety; omitting one is still accepted (optional field) but gets
  no protection.
- Direct Store Out stays known-unsafe under true concurrency until a
  follow-up ADR picks one of the §4 mechanisms. Not a blocker for the
  storekeeper workflow at current expected usage (one storekeeper per
  site, sequential in practice), but must be revisited before assuming
  multiple concurrent storekeepers on the same site's stock.
