import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, Prisma, RequisitionStatus } from '@csp-erp/db';
import type { Requisition, RequisitionLine } from '@csp-erp/db';
import type {
  ApproveRequisitionInput,
  CreateRequisitionInput,
  IssueRequisitionInput,
  RejectRequisitionInput,
} from '@csp-erp/schemas';
import { StockService } from '../stock/stock.service';
import { computeIssuedStatus } from './requisition-status.util';

type RequisitionWithLines = Requisition & { lines: RequisitionLine[] };

// Phase B backend prerequisite (requisition create idempotency,
// 2026-09-11): mirrors stock.service.ts's matchesLogicalRequest /
// assertReplayOrConflict / isIdempotencyKeyConflict exactly, applied to a
// Requisition + its lines instead of one StockMovement. "Logical request"
// = every field the client actually controls on create() today: siteId,
// remarks, and the line set (materialId + requestedQty per line, order-
// independent). There is no `purpose` or `neededBy` field on the current
// domain model -- only `remarks` exists as free text -- so this
// fingerprint cannot and does not account for a needed-by date at all.
// That is a real, separate schema gap (Phase 2 UX spec flags it), not
// something silently invented here.
function normalizeLines(
  lines: { materialId: string; requestedQty: Prisma.Decimal | number }[],
) {
  return [...lines]
    .map((l) => ({
      materialId: l.materialId,
      requestedQty: new Prisma.Decimal(l.requestedQty).toString(),
    }))
    .sort((a, b) => a.materialId.localeCompare(b.materialId));
}

function matchesLogicalCreateRequest(
  existing: RequisitionWithLines,
  input: CreateRequisitionInput,
): boolean {
  if (existing.siteId !== input.siteId) return false;
  if ((existing.remarks ?? null) !== (input.remarks ?? null)) return false;
  const a = normalizeLines(existing.lines);
  const b = normalizeLines(input.lines);
  if (a.length !== b.length) return false;
  return a.every(
    (line, i) => line.materialId === b[i].materialId && line.requestedQty === b[i].requestedQty,
  );
}

function assertCreateReplayOrConflict(
  existing: RequisitionWithLines,
  input: CreateRequisitionInput,
): RequisitionWithLines {
  if (matchesLogicalCreateRequest(existing, input)) return existing; // true replay
  throw new ConflictException(
    `Idempotency key already used for a different requisition request (site/remarks/lines don't match the original)`,
  );
}

function isIdempotencyKeyConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray((err.meta as { target?: unknown })?.target) &&
    ((err.meta as { target: string[] }).target).includes('idempotencyKey')
  );
}

@Injectable()
export class RequisitionsService {
  constructor(private readonly stockService: StockService) {}

  findAll(tenantId: string) {
    return prisma.requisition.findMany({
      where: { tenantId },
      include: { lines: true, site: true, requestedBy: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const requisition = await prisma.requisition.findFirst({
      where: { id, tenantId },
      include: {
        lines: { include: { material: true } },
        site: true,
        requestedBy: true,
        approvedBy: true,
      },
    });
    if (!requisition) throw new NotFoundException('Requisition not found');
    return requisition;
  }

  private findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string | undefined,
    client: Prisma.TransactionClient | typeof prisma,
  ) {
    if (!idempotencyKey) return Promise.resolve(null);
    return client.requisition.findFirst({
      where: { tenantId, idempotencyKey },
      include: { lines: true },
    });
  }

  async create(tenantId: string, userId: string, input: CreateRequisitionInput) {
    return prisma.$transaction(async (tx) => {
      const existing = await this.findByIdempotencyKey(tenantId, input.idempotencyKey, tx);
      if (existing) return assertCreateReplayOrConflict(existing, input);

      try {
        return await tx.requisition.create({
          data: {
            tenantId,
            siteId: input.siteId,
            remarks: input.remarks,
            requestedById: userId,
            createdById: userId,
            updatedById: userId,
            idempotencyKey: input.idempotencyKey,
            lines: {
              create: input.lines.map((line) => ({
                materialId: line.materialId,
                requestedQty: line.requestedQty,
              })),
            },
          },
          include: { lines: true },
        });
      } catch (err) {
        if (isIdempotencyKeyConflict(err)) {
          // Lost a race to a concurrent request using the same key --
          // check whether it was truly the same request (replay) or a
          // genuine conflict (different request, same key) before
          // returning. Same pattern as StockService.recordReceipt.
          const winner = await this.findByIdempotencyKey(tenantId, input.idempotencyKey, tx);
          if (winner) return assertCreateReplayOrConflict(winner, input);
        }
        throw err;
      }
    });
  }

  async submit(tenantId: string, userId: string, id: string) {
    const requisition = await this.findOne(tenantId, id);
    if (requisition.status !== RequisitionStatus.DRAFT) {
      throw new ConflictException(`Cannot submit a requisition in ${requisition.status} status`);
    }
    return prisma.requisition.update({
      where: { id },
      data: { status: RequisitionStatus.PENDING_APPROVAL, updatedById: userId },
    });
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const requisition = await this.findOne(tenantId, id);
    if (
      requisition.status !== RequisitionStatus.DRAFT &&
      requisition.status !== RequisitionStatus.PENDING_APPROVAL
    ) {
      throw new ConflictException(`Cannot cancel a requisition in ${requisition.status} status`);
    }
    return prisma.requisition.update({
      where: { id },
      data: { status: RequisitionStatus.CANCELLED, updatedById: userId },
    });
  }

  async approve(tenantId: string, userId: string, id: string, input: ApproveRequisitionInput) {
    const requisition = await this.findOne(tenantId, id);
    if (requisition.status !== RequisitionStatus.PENDING_APPROVAL) {
      throw new ConflictException(`Cannot approve a requisition in ${requisition.status} status`);
    }
    const lineIds = new Set(requisition.lines.map((l) => l.id));
    for (const line of input.lines) {
      if (!lineIds.has(line.lineId)) {
        throw new BadRequestException(`Line ${line.lineId} does not belong to this requisition`);
      }
    }

    return prisma.$transaction(async (tx) => {
      for (const line of input.lines) {
        await tx.requisitionLine.update({
          where: { id: line.lineId },
          data: { approvedQty: line.approvedQty, updatedById: userId },
        });
      }
      return tx.requisition.update({
        where: { id },
        data: {
          status: RequisitionStatus.APPROVED,
          approvedById: userId,
          approvedAt: new Date(),
          updatedById: userId,
        },
        include: { lines: true },
      });
    });
  }

  async reject(tenantId: string, userId: string, id: string, input: RejectRequisitionInput) {
    const requisition = await this.findOne(tenantId, id);
    if (requisition.status !== RequisitionStatus.PENDING_APPROVAL) {
      throw new ConflictException(`Cannot reject a requisition in ${requisition.status} status`);
    }
    return prisma.requisition.update({
      where: { id },
      data: {
        status: RequisitionStatus.REJECTED,
        rejectedReason: input.reason,
        updatedById: userId,
      },
    });
  }

  async issue(tenantId: string, userId: string, id: string, input: IssueRequisitionInput) {
    const requisition = await this.findOne(tenantId, id);
    if (
      requisition.status !== RequisitionStatus.APPROVED &&
      requisition.status !== RequisitionStatus.PARTIALLY_ISSUED
    ) {
      throw new ConflictException(`Cannot issue against a requisition in ${requisition.status} status`);
    }

    // Phase A: fixed lock-acquisition order (ascending id), independent of
    // the order lines appear in the request. Without this, two concurrent
    // multi-line issues touching the same two lines in opposite order could
    // deadlock (A locks line1 then waits on line2; B locks line2 then waits
    // on line1). Sorting first means every caller queues for the same lock
    // in the same order.
    const sortedLineIds = [...new Set(input.lines.map((l) => l.lineId))].sort();

    return prisma.$transaction(async (tx) => {
      // Row-level lock. This is the mechanism that makes "remaining to
      // issue" (below) safe to read-then-act-on: a second, concurrent
      // issue() call against any of these same lines blocks here until this
      // transaction commits or rolls back, so it can never compute
      // "remaining" from a stale pre-commit snapshot. (Direct Store Out has
      // no equivalent lock — there's no row to lock on an append-only
      // ledger with no requisition line involved. See stock.service.ts's
      // recordIssue docstring for the exact race and the candidate fixes.)
      // Validation fix (2026-09-11): scoped to this requisition's id, not
      // just the raw line ids. `id` was already proven to belong to
      // `tenantId` by findOne() above, and a RequisitionLine can only
      // belong to one requisition — so this transitively enforces tenant
      // isolation too. Without the requisitionId filter, a client-supplied
      // lineId belonging to a DIFFERENT requisition (same tenant or, worse,
      // a different one) would still get row-locked here before the
      // business-logic loop below rejects it as "does not belong to this
      // requisition" — a real, if minor, cross-tenant resource-contention
      // gap: it could briefly block a legitimate operation on someone
      // else's line for the duration of this transaction.
      await tx.$queryRaw`
        SELECT id FROM requisition_line
        WHERE id = ANY(${sortedLineIds}::text[]) AND "requisitionId" = ${id}
        FOR UPDATE
      `;

      for (const item of input.lines) {
        const line = requisition.lines.find((l) => l.id === item.lineId);
        if (!line) {
          throw new BadRequestException(`Line ${item.lineId} does not belong to this requisition`);
        }
        if (!line.approvedQty) {
          throw new ConflictException(`Line ${item.lineId} has no approved quantity`);
        }

        const issuedAgg = await tx.stockMovement.aggregate({
          where: { requisitionLineId: line.id },
          _sum: { quantity: true },
        });
        const alreadyIssued = issuedAgg._sum.quantity ?? new Prisma.Decimal(0);
        const remaining = new Prisma.Decimal(line.approvedQty).minus(alreadyIssued);

        // Existing per-line approvedQty ceiling — kept exactly as before,
        // Phase A adds the ledger-derived available-stock check in
        // stockService.recordIssue on top of this, it doesn't replace it.
        if (new Prisma.Decimal(item.quantity).greaterThan(remaining)) {
          throw new BadRequestException(
            `Cannot issue ${item.quantity} for line ${item.lineId} — only ${remaining.toString()} remains`,
          );
        }

        // Derived per-line key: one issue() submit covers N lines, but each
        // line produces its own StockMovement row, so each needs its own
        // dedup identity. A retry with the same request-level key
        // reproduces the same derived key per line and is recognized as a
        // replay of that line specifically.
        const lineIdempotencyKey = input.idempotencyKey
          ? `${input.idempotencyKey}:${line.id}`
          : undefined;

        await this.stockService.recordIssue(
          tenantId,
          userId,
          {
            siteId: requisition.siteId,
            materialId: line.materialId,
            quantity: item.quantity,
            requisitionLineId: line.id,
            idempotencyKey: lineIdempotencyKey,
          },
          tx,
        );
      }

      // Phase B: shares its status-recompute rule with StockService
      // .undoMovement() via computeIssuedStatus -- one place this
      // state-machine decision is made, not two copies that could drift.
      // Behavior here is unchanged from before: issue() only ever
      // increases issued quantities, so computeIssuedStatus's "nothing
      // issued -> APPROVED" branch can never actually trigger from this
      // call site (it can only be reached via an undo) -- verified by the
      // pre-existing tests below still passing unchanged.
      const freshLines = await tx.requisitionLine.findMany({ where: { requisitionId: id } });
      const linesForStatus = await Promise.all(
        freshLines.map(async (line) => {
          const agg = await tx.stockMovement.aggregate({
            where: { requisitionLineId: line.id },
            _sum: { quantity: true },
          });
          return {
            approvedQty: line.approvedQty,
            issuedQty: agg._sum.quantity ?? new Prisma.Decimal(0),
          };
        }),
      );

      return tx.requisition.update({
        where: { id },
        data: {
          status: computeIssuedStatus(linesForStatus),
          updatedById: userId,
        },
        include: { lines: true },
      });
    });
  }
}
