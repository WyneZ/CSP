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

describe('RequisitionsService.create — idempotency (Phase B prerequisite)', () => {
  const stockService = new StockService();
  const service = new RequisitionsService(stockService);
  let fx: Awaited<ReturnType<typeof createTenantFixtures>>;

  beforeEach(async () => {
    fx = await createTenantFixtures();
  });

  afterEach(async () => {
    if (fx) await cleanupTenant(fx.tenant.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a duplicate create with the same idempotency key and same payload replays instead of double-posting', async () => {
    const idempotencyKey = randomUUID();
    const input = {
      siteId: fx.site.id,
      remarks: 'Cement for foundation slab',
      idempotencyKey,
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    };
    const first = await service.create(fx.tenant.id, fx.user.id, input);
    const second = await service.create(fx.tenant.id, fx.user.id, input);
    expect(second.id).toBe(first.id);
    const count = await prisma.requisition.count({
      where: { tenantId: fx.tenant.id, idempotencyKey },
    });
    expect(count).toBe(1); // not 2
  });

  it('rejects the same key reused with different remarks as a conflict, not a silent replay', async () => {
    const idempotencyKey = randomUUID();
    await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      remarks: 'Original purpose',
      idempotencyKey,
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    });
    await expect(
      service.create(fx.tenant.id, fx.user.id, {
        siteId: fx.site.id,
        remarks: 'Different purpose',
        idempotencyKey,
        lines: [{ materialId: fx.material.id, requestedQty: 10 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects the same key reused with a different material as a conflict', async () => {
    const otherMaterial = await prisma.material.create({
      data: {
        tenantId: fx.tenant.id,
        code: `MAT-${randomUUID().slice(0, 8)}`,
        name: 'Other Material',
        unit: 'kg',
      },
    });
    const idempotencyKey = randomUUID();
    await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      idempotencyKey,
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    });
    await expect(
      service.create(fx.tenant.id, fx.user.id, {
        siteId: fx.site.id,
        idempotencyKey,
        lines: [{ materialId: otherMaterial.id, requestedQty: 10 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects the same key reused with a different quantity as a conflict', async () => {
    const idempotencyKey = randomUUID();
    await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      idempotencyKey,
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    });
    await expect(
      service.create(fx.tenant.id, fx.user.id, {
        siteId: fx.site.id,
        idempotencyKey,
        lines: [{ materialId: fx.material.id, requestedQty: 20 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('treats the same lines supplied in a different order as the same logical request (replay, not conflict)', async () => {
    const otherMaterial = await prisma.material.create({
      data: {
        tenantId: fx.tenant.id,
        code: `MAT-${randomUUID().slice(0, 8)}`,
        name: 'Other Material',
        unit: 'kg',
      },
    });
    const idempotencyKey = randomUUID();
    const first = await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      idempotencyKey,
      lines: [
        { materialId: fx.material.id, requestedQty: 10 },
        { materialId: otherMaterial.id, requestedQty: 5 },
      ],
    });
    const second = await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      idempotencyKey,
      lines: [
        { materialId: otherMaterial.id, requestedQty: 5 },
        { materialId: fx.material.id, requestedQty: 10 },
      ],
    });
    expect(second.id).toBe(first.id); // normalizeLines() sorts by materialId before comparing
  });

  it('two different keys from the same tenant create two independent requisitions (no collision)', async () => {
    const first = await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      idempotencyKey: randomUUID(),
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    });
    const second = await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      idempotencyKey: randomUUID(),
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    });
    expect(second.id).not.toBe(first.id);
  });

  it('the same idempotency key is scoped per tenant, not global — reuse across tenants is allowed independently', async () => {
    const idempotencyKey = randomUUID();
    const otherFx = await createTenantFixtures();
    try {
      const first = await service.create(fx.tenant.id, fx.user.id, {
        siteId: fx.site.id,
        idempotencyKey,
        lines: [{ materialId: fx.material.id, requestedQty: 10 }],
      });
      const second = await service.create(otherFx.tenant.id, otherFx.user.id, {
        siteId: otherFx.site.id,
        idempotencyKey,
        lines: [{ materialId: otherFx.material.id, requestedQty: 10 }],
      });
      expect(second.id).not.toBe(first.id);
      expect(second.tenantId).toBe(otherFx.tenant.id);
    } finally {
      await cleanupTenant(otherFx.tenant.id);
    }
  });

  it('omitting the idempotency key preserves existing behavior — each call creates a new requisition', async () => {
    const first = await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    });
    const second = await service.create(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    });
    expect(second.id).not.toBe(first.id);
    expect(first.idempotencyKey).toBeNull();
    expect(second.idempotencyKey).toBeNull();
  });

  it('two concurrent creates with the same key and same payload produce exactly one requisition row', async () => {
    const idempotencyKey = randomUUID();
    const input = {
      siteId: fx.site.id,
      idempotencyKey,
      lines: [{ materialId: fx.material.id, requestedQty: 10 }],
    };
    // Both calls are the SAME logical request, so both are expected to
    // resolve — the loser of the unique-constraint race re-reads and
    // replays the winner's row rather than erroring out (see
    // assertCreateReplayOrConflict / isIdempotencyKeyConflict in
    // requisitions.service.ts). This is different from the concurrent
    // ISSUE test above, where two DIFFERENT requests race for the same
    // finite resource and one is correctly expected to be rejected.
    const results = await Promise.allSettled([
      service.create(fx.tenant.id, fx.user.id, input),
      service.create(fx.tenant.id, fx.user.id, input),
    ]);
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>> =>
        r.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(2);
    expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);

    const count = await prisma.requisition.count({
      where: { tenantId: fx.tenant.id, idempotencyKey },
    });
    expect(count).toBe(1); // exactly one row despite two concurrent inserts
  });
});

describe('RequisitionsService.issue + StockService.undoMovement — status recomputation (Phase B prerequisite)', () => {
  const stockService = new StockService();
  const service = new RequisitionsService(stockService);
  let fx: Awaited<ReturnType<typeof createTenantFixtures>>;

  beforeEach(async () => {
    fx = await createTenantFixtures();
    await stockService.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 100,
    });
  });

  afterEach(async () => {
    if (fx) await cleanupTenant(fx.tenant.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Same bypass-submit()/approve() shortcut as the issue() describe block
  // above, generalized to accept N lines with independent quantities.
  async function createApprovedRequisitionWithLines(
    lines: { requestedQty: number; approvedQty: number }[],
  ) {
    return prisma.requisition.create({
      data: {
        tenantId: fx.tenant.id,
        siteId: fx.site.id,
        status: RequisitionStatus.APPROVED,
        requestedById: fx.user.id,
        approvedById: fx.user.id,
        approvedAt: new Date(),
        lines: {
          create: lines.map((l) => ({
            materialId: fx.material.id,
            requestedQty: l.requestedQty,
            approvedQty: l.approvedQty,
          })),
        },
      },
      include: { lines: true },
    });
  }

  it('undoing the only issue on a fully-issued requisition returns it to APPROVED, not stuck at ISSUED', async () => {
    const req = await createApprovedRequisitionWithLines([{ requestedQty: 10, approvedQty: 10 }]);
    const issued = await service.issue(fx.tenant.id, fx.user.id, req.id, {
      lines: [{ lineId: req.lines[0].id, quantity: 10 }],
    });
    expect(issued.status).toBe(RequisitionStatus.ISSUED);

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { requisitionLineId: req.lines[0].id },
    });
    await stockService.undoMovement(fx.tenant.id, fx.user.id, movement.id);

    const after = await prisma.requisition.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe(RequisitionStatus.APPROVED); // ledger truth: nothing issued anymore
  });

  it('undoing one line of a multi-line ISSUED requisition drops it to PARTIALLY_ISSUED while the untouched line stays fully issued', async () => {
    const req = await createApprovedRequisitionWithLines([
      { requestedQty: 10, approvedQty: 10 },
      { requestedQty: 5, approvedQty: 5 },
    ]);
    const [lineA, lineB] = req.lines;
    const issued = await service.issue(fx.tenant.id, fx.user.id, req.id, {
      lines: [
        { lineId: lineA.id, quantity: 10 },
        { lineId: lineB.id, quantity: 5 },
      ],
    });
    expect(issued.status).toBe(RequisitionStatus.ISSUED);

    const movementA = await prisma.stockMovement.findFirstOrThrow({
      where: { requisitionLineId: lineA.id },
    });
    await stockService.undoMovement(fx.tenant.id, fx.user.id, movementA.id);

    const after = await prisma.requisition.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe(RequisitionStatus.PARTIALLY_ISSUED); // lineB is still fully issued, lineA is not

    const lineBIssued = await prisma.stockMovement.aggregate({
      where: { requisitionLineId: lineB.id },
      _sum: { quantity: true },
    });
    expect(lineBIssued._sum.quantity?.toNumber()).toBe(5); // untouched by lineA's undo
  });

  it('undoing the second of two sequential issues leaves the truthful remaining quantity, not a hardcoded rollback', async () => {
    const req = await createApprovedRequisitionWithLines([{ requestedQty: 10, approvedQty: 10 }]);
    const lineId = req.lines[0].id;

    await service.issue(fx.tenant.id, fx.user.id, req.id, {
      lines: [{ lineId, quantity: 4 }],
    });
    const fullyIssued = await service.issue(fx.tenant.id, fx.user.id, req.id, {
      lines: [{ lineId, quantity: 6 }],
    });
    expect(fullyIssued.status).toBe(RequisitionStatus.ISSUED); // 4 + 6 = 10/10

    const movements = await prisma.stockMovement.findMany({
      where: { requisitionLineId: lineId },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements).toHaveLength(2);
    await stockService.undoMovement(fx.tenant.id, fx.user.id, movements[1].id); // undo the 6-unit issue only

    const after = await prisma.requisition.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe(RequisitionStatus.PARTIALLY_ISSUED); // 4 of 10 still stands -- not APPROVED, not ISSUED

    const agg = await prisma.stockMovement.aggregate({
      where: { requisitionLineId: lineId },
      _sum: { quantity: true },
    });
    expect(agg._sum.quantity?.toNumber()).toBe(4); // the first issue survives untouched; only the second was undone
  });
});

