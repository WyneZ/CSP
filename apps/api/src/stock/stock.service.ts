import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, Prisma, MovementType } from '@csp-erp/db';
import type { StockMovement } from '@csp-erp/db';
import type { CreateReceiptInput, CreateIssueInput } from '@csp-erp/schemas';
import { computeIssuedStatus } from '../requisitions/requisition-status.util';

type Tx = Prisma.TransactionClient;

// Phase B backend prerequisite (same-day undo, 2026-09-11): V1 assumption
// -- exactly one site, one timezone (Asia/Yangon, per the approved
// correction). No timezone column exists on Tenant/Site/User yet; when
// multi-site support needs multiple timezones this must become a
// per-site lookup (a new Site.timezone column) instead of a hardcoded
// constant. Tracked as a known limitation, not solved here -- adding
// timezone infrastructure was explicitly out of scope for this task.
const SITE_TIMEZONE = 'Asia/Yangon';

function siteLocalCalendarDate(date: Date): string {
  // Node's bundled ICU/Intl already has full IANA tz data -- this needs no
  // extra dependency (deliberately avoided adding a timezone library for
  // one constant). 'en-CA' formats as YYYY-MM-DD, which is all that's
  // compared -- the actual locale is irrelevant, only the format is used.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isSameSiteLocalDay(a: Date, b: Date): boolean {
  return siteLocalCalendarDate(a) === siteLocalCalendarDate(b);
}

// Phase A validation fix: a client-generated key identifies one specific
// logical request, not "any request from this client ever." If the same
// (tenantId, idempotencyKey) shows up with different site/material/
// quantity/movement fields, that's a reused key on a *different* request —
// silently replaying the old row would hand the caller a result for a
// request they didn't make. This never fires for a genuine retry (same
// fields every time); it only fires on key reuse across logically
// different requests, which is a client bug worth surfacing loudly.
function matchesLogicalRequest(
  existing: StockMovement,
  input: { siteId: string; materialId: string; quantity: number; requisitionLineId?: string },
  movementType: MovementType,
): boolean {
  return (
    existing.siteId === input.siteId &&
    existing.materialId === input.materialId &&
    existing.movementType === movementType &&
    new Prisma.Decimal(existing.quantity).equals(new Prisma.Decimal(input.quantity)) &&
    (existing.requisitionLineId ?? null) === (input.requisitionLineId ?? null)
  );
}

function assertReplayOrConflict(
  existing: StockMovement,
  input: { siteId: string; materialId: string; quantity: number; requisitionLineId?: string },
  movementType: MovementType,
): StockMovement {
  if (matchesLogicalRequest(existing, input, movementType)) return existing; // true replay
  throw new ConflictException(
    `Idempotency key already used for a different request (site/material/quantity/type don't match the original)`,
  );
}

// Prisma's unique-constraint violation code. Checked narrowly against the
// idempotencyKey index name so we don't swallow an unrelated P2002 (e.g. a
// real duplicate-code error on another table) under the same catch.
function isIdempotencyKeyConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray((err.meta as { target?: unknown })?.target) &&
    ((err.meta as { target: string[] }).target).includes('idempotencyKey')
  );
}

@Injectable()
export class StockService {
  // Phase A (2026-09-11, inventory correctness decision package — not yet
  // written up as its own docs/adr entry, see FINAL PHASE A REVIEW):
  // available stock is always derived from the ledger, never stored. This
  // is the single place that computation happens so both requisition-issue
  // and direct Store Out enforce the same rule.
  async getAvailableQuantity(
    tenantId: string,
    siteId: string,
    materialId: string,
    client: Tx | typeof prisma = prisma,
  ): Promise<Prisma.Decimal> {
    const grouped = await client.stockMovement.groupBy({
      by: ['movementType'],
      where: { tenantId, siteId, materialId },
      _sum: { quantity: true },
    });
    let available = new Prisma.Decimal(0);
    for (const row of grouped) {
      const sum = row._sum.quantity ?? new Prisma.Decimal(0);
      available =
        row.movementType === MovementType.RECEIPT ? available.plus(sum) : available.minus(sum);
    }
    return available;
  }

  private findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string | undefined,
    client: Tx | typeof prisma,
  ) {
    if (!idempotencyKey) return Promise.resolve(null);
    return client.stockMovement.findFirst({ where: { tenantId, idempotencyKey } });
  }

  async recordReceipt(tenantId: string, userId: string, input: CreateReceiptInput) {
    return prisma.$transaction(async (tx) => {
      const existing = await this.findByIdempotencyKey(tenantId, input.idempotencyKey, tx);
      if (existing) return assertReplayOrConflict(existing, input, MovementType.RECEIPT);

      try {
        return await tx.stockMovement.create({
          data: {
            tenantId,
            siteId: input.siteId,
            materialId: input.materialId,
            movementType: MovementType.RECEIPT,
            quantity: input.quantity,
            remarks: input.remarks,
            createdById: userId,
            idempotencyKey: input.idempotencyKey,
          },
        });
      } catch (err) {
        if (isIdempotencyKeyConflict(err)) {
          // Lost a race to a concurrent request using the same key — check
          // whether it was truly the same request (replay) or a genuine
          // conflict (different request, same key) before returning.
          const winner = await this.findByIdempotencyKey(tenantId, input.idempotencyKey, tx);
          if (winner) return assertReplayOrConflict(winner, input, MovementType.RECEIPT);
        }
        throw err;
      }
    });
  }

  // client is passed by RequisitionsService.issue(), which already owns a
  // transaction AND has row-locked the RequisitionLine before calling this
  // -- so when client is given, we run inside it rather than opening a
  // second transaction.
  //
  // KNOWN LIMITATION (direct Store Out, no requisition involved) -- exact
  // race, reproduced deterministically in stock.service.spec.ts's "KNOWN
  // LIMITATION" test:
  //   1. Available quantity for (tenant, site, material) is 10.
  //   2. Transaction A calls getAvailableQuantity -> reads 10, has not
  //      committed yet.
  //   3. Transaction B (fully separate request) calls getAvailableQuantity
  //      -> ALSO reads 10, because Postgres's default Read Committed
  //      isolation only hides uncommitted writes from other transactions --
  //      it does not serialize concurrent readers against each other.
  //   4. A checks 6 <= 10, inserts its ISSUE(6), commits.
  //   5. B checks 6 <= 10 (using its own, already-taken snapshot from step
  //      3), inserts its ISSUE(6), commits.
  //   6. Result: 12 issued against 10 available. Available stock is now
  //      -2. Neither transaction did anything individually wrong; the bug
  //      is that nothing serialized "read available, then act on it"
  //      across the two of them.
  // This can't be fixed the way the requisition path is (row-level lock
  // on the RequisitionLine) because there is no RequisitionLine involved,
  // and per the append-only-ledger rule there is no mutable "stock" row
  // to lock either.
  //
  // What WOULD fix it (a future decision, deliberately not made here --
  // Phase A's approved constraints say not to invent a Store-Out-specific
  // concurrency mechanism unless it's actually required):
  //   (a) pg_advisory_xact_lock(hashtext(tenantId||siteId||materialId)) at
  //       the top of this transaction -- serializes concurrent Store Outs
  //       for the same (tenant, site, material) using Postgres's
  //       transaction-scoped advisory locks, without needing a real row to
  //       lock. Cheapest option; the lock is purely logical (an
  //       application-chosen key), so it needs care to pick a hash
  //       function with an acceptably low collision rate.
  //   (b) Re-run this transaction at SERIALIZABLE isolation and retry on
  //       the resulting serialization-failure error (Postgres detects the
  //       conflict and aborts one of the two transactions instead of
  //       letting both commit). Correct and needs no new schema, but every
  //       caller of recordIssue needs a retry loop, and contention under
  //       load causes more aborts/retries than (a).
  //   (c) A dedicated, deliberately mutable stock_balance row per (tenant,
  //       site, material), updated via SELECT ... FOR UPDATE exactly like
  //       the requisition-line path. Gives the same correctness as the
  //       requisition path, but reintroduces a stored, cached total that
  //       must be kept in sync with the ledger -- the exact "mutable
  //       quantity" shape the schema foundations rule (StockMovement is
  //       the only source of truth) was written to avoid. Would need its
  //       own ADR before touching the schema.
  // (a) is the natural default if/when this needs to actually be closed.
  async recordIssue(
    tenantId: string,
    userId: string,
    input: CreateIssueInput & { requisitionLineId?: string },
    client?: Tx,
  ) {
    const run = async (tx: Tx | typeof prisma) => {
      const existing = await this.findByIdempotencyKey(tenantId, input.idempotencyKey, tx);
      if (existing) return assertReplayOrConflict(existing, input, MovementType.ISSUE);

      const available = await this.getAvailableQuantity(tenantId, input.siteId, input.materialId, tx);
      if (new Prisma.Decimal(input.quantity).greaterThan(available)) {
        throw new ConflictException(
          `Insufficient stock: ${available.toString()} available, ${input.quantity} requested`,
        );
      }

      try {
        return await tx.stockMovement.create({
          data: {
            tenantId,
            siteId: input.siteId,
            materialId: input.materialId,
            movementType: MovementType.ISSUE,
            quantity: input.quantity,
            remarks: input.remarks,
            requisitionLineId: input.requisitionLineId,
            createdById: userId,
            idempotencyKey: input.idempotencyKey,
          },
        });
      } catch (err) {
        if (isIdempotencyKeyConflict(err)) {
          const winner = await this.findByIdempotencyKey(tenantId, input.idempotencyKey, tx);
          if (winner) return assertReplayOrConflict(winner, input, MovementType.ISSUE);
        }
        throw err;
      }
    };

    if (client) return run(client);
    return prisma.$transaction((tx) => run(tx));
  }

  // Phase B backend prerequisite (same-day undo, 2026-09-11): one dispatch
  // point for both GRN (RECEIPT) and Issue undo -- every safety check
  // below (creator / same-day / not-already-a-reversal / not-already-
  // reversed) is identical regardless of movement type. Only the final
  // type-specific safety check (RECEIPT: would stock go negative?) and the
  // post-write side effect (ISSUE tied to a requisition line: recompute
  // that requisition's status) differ, and both are handled inline below
  // rather than via two near-duplicate methods.
  //
  // The compensating movement is the SAME movementType as the original,
  // with its quantity NEGATED, and reversalOfId pointing at the original
  // -- the original StockMovement row is never edited or deleted (schema
  // foundations rule; the append-only ledger's whole point). This
  // representation was chosen deliberately after checking every existing
  // ledger-derived query it has to stay compatible with:
  //   - getAvailableQuantity(): SUMs quantity per movementType with no
  //     sign massaging, so a negative-quantity same-type row nets out
  //     correctly with zero changes to that function.
  //   - RequisitionsService.issue()'s per-line "issued so far" aggregate:
  //     SUMs quantity for a requisitionLineId with NO movementType filter
  //     at all -- a same-type reversal nets correctly through it; an
  //     opposite-type reversal (e.g. a RECEIPT "undoing" an ISSUE) would
  //     NOT, because it would still be summed in but wouldn't represent
  //     the right sign relative to approvedQty. Same-type-negated is the
  //     only representation that is mathematically compatible with both
  //     call sites unchanged.
  async undoMovement(tenantId: string, userId: string, movementId: string) {
    return prisma.$transaction(async (tx) => {
      // Row-level lock -- same pattern as the RequisitionLine lock in
      // RequisitionsService.issue(). Without it, two near-simultaneous
      // undo taps on the same movement could both pass the "not already
      // reversed" check below before either commits its compensating row,
      // producing two reversals of one movement -- exactly the class of
      // race Phase A already closed for concurrent requisition issues.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM stock_movement WHERE id = ${movementId} AND "tenantId" = ${tenantId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException('Movement not found');
      }

      const movement = await tx.stockMovement.findUniqueOrThrow({ where: { id: movementId } });

      if (movement.createdById !== userId) {
        throw new ForbiddenException('Only the person who recorded this can undo it');
      }
      if (movement.reversalOfId !== null) {
        throw new ConflictException('A correcting entry cannot itself be undone');
      }
      const alreadyReversed = await tx.stockMovement.findFirst({
        where: { reversalOfId: movement.id },
      });
      if (alreadyReversed) {
        throw new ConflictException('This has already been undone');
      }
      if (!isSameSiteLocalDay(movement.createdAt, new Date())) {
        throw new ConflictException(
          'This can only be undone on the same day it was recorded (site-local time)',
        );
      }

      if (movement.movementType === MovementType.RECEIPT) {
        const available = await this.getAvailableQuantity(
          tenantId,
          movement.siteId,
          movement.materialId,
          tx,
        );
        const afterUndo = available.minus(movement.quantity);
        if (afterUndo.lessThan(0)) {
          throw new ConflictException(
            `Undoing this receipt would leave stock at ${afterUndo.toString()} -- later issues have already used this material`,
          );
        }
      }

      const compensating = await tx.stockMovement.create({
        data: {
          tenantId,
          siteId: movement.siteId,
          materialId: movement.materialId,
          movementType: movement.movementType,
          quantity: new Prisma.Decimal(movement.quantity).times(-1),
          requisitionLineId: movement.requisitionLineId,
          reversalOfId: movement.id,
          remarks: `Undo of movement ${movement.id}`,
          createdById: userId,
        },
      });

      // Only an ISSUE tied to a requisition line has a requisition status
      // to recompute -- a direct Store Out (no requisitionLineId) or a
      // RECEIPT never does.
      if (movement.requisitionLineId) {
        const line = await tx.requisitionLine.findUniqueOrThrow({
          where: { id: movement.requisitionLineId },
        });
        const siblingLines = await tx.requisitionLine.findMany({
          where: { requisitionId: line.requisitionId },
        });
        const linesForStatus = await Promise.all(
          siblingLines.map(async (l) => {
            const agg = await tx.stockMovement.aggregate({
              where: { requisitionLineId: l.id },
              _sum: { quantity: true },
            });
            return {
              approvedQty: l.approvedQty,
              issuedQty: agg._sum.quantity ?? new Prisma.Decimal(0),
            };
          }),
        );
        await tx.requisition.update({
          where: { id: line.requisitionId },
          data: { status: computeIssuedStatus(linesForStatus), updatedById: userId },
        });
      }

      return compensating;
    });
  }

  async getCurrentStock(tenantId: string, siteId?: string, materialId?: string) {
    const grouped = await prisma.stockMovement.groupBy({
      by: ['siteId', 'materialId', 'movementType'],
      where: { tenantId, ...(siteId && { siteId }), ...(materialId && { materialId }) },
      _sum: { quantity: true },
    });

    const byKey = new Map<string, { siteId: string; materialId: string; quantity: Prisma.Decimal }>();
    for (const row of grouped) {
      const key = `${row.siteId}:${row.materialId}`;
      const existing = byKey.get(key) ?? {
        siteId: row.siteId,
        materialId: row.materialId,
        quantity: new Prisma.Decimal(0),
      };
      const sum = row._sum.quantity ?? new Prisma.Decimal(0);
      existing.quantity =
        row.movementType === MovementType.RECEIPT
          ? existing.quantity.plus(sum)
          : existing.quantity.minus(sum);
      byKey.set(key, existing);
    }
    return Array.from(byKey.values());
  }

  getMovementHistory(tenantId: string, siteId?: string, materialId?: string) {
    return prisma.stockMovement.findMany({
      where: { tenantId, ...(siteId && { siteId }), ...(materialId && { materialId }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
