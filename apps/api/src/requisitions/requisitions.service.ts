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

    return prisma.$transaction(async (tx) => {
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

        if (new Prisma.Decimal(item.quantity).greaterThan(remaining)) {
          throw new BadRequestException(
            `Cannot issue ${item.quantity} for line ${item.lineId} — only ${remaining.toString()} remains`,
          );
        }

        await this.stockService.recordIssue(
          tenantId,
          userId,
          {
            siteId: requisition.siteId,
            materialId: line.materialId,
            quantity: item.quantity,
            requisitionLineId: line.id,
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
