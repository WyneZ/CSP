import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, Prisma, RequisitionStatus } from '@csp-erp/db';
import type {
  ApproveRequisitionInput,
  CreateRequisitionInput,
  IssueRequisitionInput,
  RejectRequisitionInput,
} from '@csp-erp/schemas';
import { StockService } from '../stock/stock.service';

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

  create(tenantId: string, userId: string, input: CreateRequisitionInput) {
    return prisma.requisition.create({
      data: {
        tenantId,
        siteId: input.siteId,
        remarks: input.remarks,
        requestedById: userId,
        createdById: userId,
        updatedById: userId,
        lines: {
          create: input.lines.map((line) => ({
            materialId: line.materialId,
            requestedQty: line.requestedQty,
          })),
        },
      },
      include: { lines: true },
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

      const freshLines = await tx.requisitionLine.findMany({ where: { requisitionId: id } });
      let allFullyIssued = true;
      for (const line of freshLines) {
        if (!line.approvedQty) continue;
        const agg = await tx.stockMovement.aggregate({
          where: { requisitionLineId: line.id },
          _sum: { quantity: true },
        });
        const issuedSoFar = agg._sum.quantity ?? new Prisma.Decimal(0);
        if (issuedSoFar.lessThan(line.approvedQty)) {
          allFullyIssued = false;
        }
      }

      return tx.requisition.update({
        where: { id },
        data: {
          status: allFullyIssued ? RequisitionStatus.ISSUED : RequisitionStatus.PARTIALLY_ISSUED,
          updatedById: userId,
        },
        include: { lines: true },
      });
    });
  }
}
