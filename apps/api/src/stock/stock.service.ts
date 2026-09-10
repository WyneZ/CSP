import { Injectable } from '@nestjs/common';
import { prisma, Prisma, MovementType } from '@csp-erp/db';
import type { CreateReceiptInput, CreateIssueInput } from '@csp-erp/schemas';

type Tx = Prisma.TransactionClient;

@Injectable()
export class StockService {
  recordReceipt(tenantId: string, userId: string, input: CreateReceiptInput) {
    return prisma.stockMovement.create({
      data: {
        tenantId,
        siteId: input.siteId,
        materialId: input.materialId,
        movementType: MovementType.RECEIPT,
        quantity: input.quantity,
        remarks: input.remarks,
        createdById: userId,
      },
    });
  }

  // client is optional so RequisitionsService can pass its own $transaction
  // client in — approve/issue on a requisition and the resulting ledger
  // rows have to commit or fail together.
  recordIssue(
    tenantId: string,
    userId: string,
    input: CreateIssueInput & { requisitionLineId?: string },
    client: Tx | typeof prisma = prisma,
  ) {
    return client.stockMovement.create({
      data: {
        tenantId,
        siteId: input.siteId,
        materialId: input.materialId,
        movementType: MovementType.ISSUE,
        quantity: input.quantity,
        remarks: input.remarks,
        requisitionLineId: input.requisitionLineId,
        createdById: userId,
      },
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
