// Phase A — inventory correctness. Requires a live Postgres reachable via
// DATABASE_URL (see src/test-setup-env.ts for how it's loaded — prefer
// .env.test over your dev .env). Run with:
//   pnpm --filter api test requisitions.service.spec.ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma, RequisitionStatus } from '@csp-erp/db';
import { StockService } from '../stock/stock.service';
import { RequisitionsService } from './requisitions.service';
import { createTenantFixtures, cleanupTenant } from '../test-utils/fixtures';

describe('RequisitionsService.issue — Phase A', () => {
  const stockService = new StockService();
  const service = new RequisitionsService(stockService);
  let fx: Awaited<ReturnType<typeof createTenantFixtures>>;

  beforeEach(async () => {
    fx = await createTenantFixtures();
    // Enough stock at fx.site for every test below unless a test
    // deliberately uses a different, empty site to isolate the
    // ledger-derived check from the pre-existing approvedQty check.
    await stockService.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 100,
    });
  });

  afterEach(async () => {
    // Guarded: if beforeEach itself failed (e.g. no DB reachable), fx is
    // never assigned — don't compound that failure with a second,
    // confusing "Cannot read properties of undefined" from cleanup.
    if (fx) await cleanupTenant(fx.tenant.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Bypasses submit()/approve() on purpose — those are pre-existing and
  // unchanged in Phase A. These tests are about issue() specifically.
  async function createApprovedRequisition(approvedQty: number, siteId = fx.site.id) {
    return prisma.requisition.create({
      data: {
        tenantId: fx.tenant.id,
        siteId,
        status: RequisitionStatus.APPROVED,
        requestedById: fx.user.id,
        approvedById: fx.user.id,
        approvedAt: new Date(),
        lines: {
          create: [{ materialId: fx.material.id, requestedQty: approvedQty, approvedQty }],
        },
      },
      include: { lines: true },
    });
  }

  it('supports a partial issue, leaving the requisition PARTIALLY_ISSUED', async () => {
    const req = await createApprovedRequisition(10);
    const result = await service.issue(fx.tenant.id, fx.user.id, req.id, {
      lines: [{ lineId: req.lines[0].id, quantity: 4 }],
    });
    expect(result.status).toBe(RequisitionStatus.PARTIALLY_ISSUED);
  });

  it('a full issue moves the requisition to ISSUED', async () => {
    const req = await createApprovedRequisition(10);
    const result = await service.issue(fx.tenant.id, fx.user.id, req.id, {
      lines: [{ lineId: req.lines[0].id, quantity: 10 }],
    });
    expect(result.status).toBe(RequisitionStatus.ISSUED);
  });

  it('rejects issuing more than the approved quantity (pre-existing check, unchanged)', async () => {
    const req = await createApprovedRequisition(10);
    await expect(
      service.issue(fx.tenant.id, fx.user.id, req.id, {
        lines: [{ lineId: req.lines[0].id, quantity: 11 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects issuing more than actual ledger stock even when approvedQty would allow it', async () => {
    const emptySite = await prisma.site.create({
      data: { tenantId: fx.tenant.id, name: `Empty Site ${randomUUID()}` },
    });
    const req = await createApprovedRequisition(5, emptySite.id);
    await expect(
      service.issue(fx.tenant.id, fx.user.id, req.id, {
        lines: [{ lineId: req.lines[0].id, quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects issuing against a requisition that is not APPROVED/PARTIALLY_ISSUED', async () => {
    const req = await prisma.requisition.create({
      data: {
        tenantId: fx.tenant.id,
        siteId: fx.site.id,
        status: RequisitionStatus.DRAFT,
        requestedById: fx.user.id,
        lines: { create: [{ materialId: fx.material.id, requestedQty: 5 }] },
      },
      include: { lines: true },
    });
    await expect(
      service.issue(fx.tenant.id, fx.user.id, req.id, {
        lines: [{ lineId: req.lines[0].id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a duplicate issue submit with the same idempotency key does not double-post', async () => {
    const req = await createApprovedRequisition(10);
    const idempotencyKey = randomUUID();
    await service.issue(fx.tenant.id, fx.user.id, req.id, {
      idempotencyKey,
      lines: [{ lineId: req.lines[0].id, quantity: 4 }],
    });
    await service.issue(fx.tenant.id, fx.user.id, req.id, {
      idempotencyKey,
      lines: [{ lineId: req.lines[0].id, quantity: 4 }],
    });
    const agg = await prisma.stockMovement.aggregate({
      where: { requisitionLineId: req.lines[0].id },
      _sum: { quantity: true },
    });
    expect(agg._sum.quantity?.toNumber()).toBe(4); // not 8
  });

  it('serializes two concurrent issues against the same line so neither oversells', async () => {
    const req = await createApprovedRequisition(10);
    const lineId = req.lines[0].id;

    // 6 + 6 = 12 > approvedQty of 10 — exactly one of these two concurrent
    // attempts must be rejected. Without the FOR UPDATE lock added in
    // Phase A, both could read "remaining = 10" before either commits and
    // both would succeed, over-issuing by 2.
    const results = await Promise.allSettled([
      service.issue(fx.tenant.id, fx.user.id, req.id, { lines: [{ lineId, quantity: 6 }] }),
      service.issue(fx.tenant.id, fx.user.id, req.id, { lines: [{ lineId, quantity: 6 }] }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const agg = await prisma.stockMovement.aggregate({
      where: { requisitionLineId: lineId },
      _sum: { quantity: true },
    });
    expect(agg._sum.quantity?.toNumber()).toBe(6);
  });

  it('atomicity: if one line in a multi-line issue fails, no line in that call posts anything', async () => {
    // Two lines: the first is issuable on its own, the second requests more
    // than its approvedQty allows. If the transaction weren't atomic, the
    // first line's StockMovement could survive even though the whole
    // request should be rejected.
    const req = await prisma.requisition.create({
      data: {
        tenantId: fx.tenant.id,
        siteId: fx.site.id,
        status: RequisitionStatus.APPROVED,
        requestedById: fx.user.id,
        approvedById: fx.user.id,
        approvedAt: new Date(),
        lines: {
          create: [
            { materialId: fx.material.id, requestedQty: 10, approvedQty: 10 },
            { materialId: fx.material.id, requestedQty: 5, approvedQty: 5 },
          ],
        },
      },
      include: { lines: true },
    });
    const [okLine, badLine] = req.lines;

    await expect(
      service.issue(fx.tenant.id, fx.user.id, req.id, {
        lines: [
          { lineId: okLine.id, quantity: 5 }, // fine on its own
          { lineId: badLine.id, quantity: 999 }, // exceeds approvedQty of 5
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const agg = await prisma.stockMovement.aggregate({
      where: { requisitionLineId: { in: [okLine.id, badLine.id] } },
      _sum: { quantity: true },
    });
    expect(agg._sum.quantity).toBeNull(); // nothing posted for either line

    const fresh = await prisma.requisition.findUniqueOrThrow({ where: { id: req.id } });
    expect(fresh.status).toBe(RequisitionStatus.APPROVED); // status also unchanged
  });

  it('a client-supplied lineId from a different requisition is rejected cleanly', async () => {
    const reqA = await createApprovedRequisition(10);
    const reqB = await createApprovedRequisition(10);
    // lineId genuinely exists (in reqB) but not under reqA — must be
    // rejected by issue(reqA). The Phase A validation fix scopes the FOR
    // UPDATE lock query itself to this requisition's id (not just the raw
    // line ids), so reqB's row is never even selected by reqA's call —
    // this test proves the functional outcome (clean rejection, no state
    // corruption); the lock-scoping specifically would need a concurrency
    // harness to observe directly, not a sequential test like this one.
    await expect(
      service.issue(fx.tenant.id, fx.user.id, reqA.id, {
        lines: [{ lineId: reqB.lines[0].id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // And reqB itself is completely unaffected — normal issue against its
    // own line still works.
    const result = await service.issue(fx.tenant.id, fx.user.id, reqB.id, {
      lines: [{ lineId: reqB.lines[0].id, quantity: 5 }],
    });
    expect(result.status).toBe(RequisitionStatus.PARTIALLY_ISSUED);
  });

  it('tenant isolation: a requisition in tenant A cannot be issued against under tenant B', async () => {
    const req = await createApprovedRequisition(10);
    const otherFx = await createTenantFixtures();
    try {
      await expect(
        service.issue(otherFx.tenant.id, otherFx.user.id, req.id, {
          lines: [{ lineId: req.lines[0].id, quantity: 1 }],
        }),
      ).rejects.toThrow(); // findOne() scopes by tenantId -> NotFoundException
    } finally {
      await cleanupTenant(otherFx.tenant.id);
    }
  });
});
