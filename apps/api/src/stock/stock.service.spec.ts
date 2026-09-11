// Phase A — inventory correctness. Requires a live Postgres reachable via
// DATABASE_URL (see src/test-setup-env.ts for how it's loaded — prefer
// .env.test over your dev .env). Run with:
//   pnpm --filter api test stock.service.spec.ts
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma, MovementType, Role } from '@csp-erp/db';
import { StockService } from './stock.service';
import { createTenantFixtures, cleanupTenant } from '../test-utils/fixtures';

describe('StockService — Phase A', () => {
  const service = new StockService();
  let fx: Awaited<ReturnType<typeof createTenantFixtures>>;

  beforeEach(async () => {
    fx = await createTenantFixtures();
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

  it('blocks a direct Store Out that exceeds available stock, and posts nothing', async () => {
    await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 10,
    });

    await expect(
      service.recordIssue(fx.tenant.id, fx.user.id, {
        siteId: fx.site.id,
        materialId: fx.material.id,
        quantity: 15,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const available = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    expect(available.toNumber()).toBe(10);
  });

  it('allows a Store Out for exactly the available quantity (boundary, not off-by-one)', async () => {
    await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 10,
    });
    await service.recordIssue(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 10,
    });
    const available = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    expect(available.toNumber()).toBe(0);
  });

  it('a duplicate receipt with the same idempotency key posts only once', async () => {
    const idempotencyKey = randomUUID();
    const first = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 20,
      idempotencyKey,
    });
    const second = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 20,
      idempotencyKey,
    });

    expect(second.id).toBe(first.id); // replay returns the original row

    const count = await prisma.stockMovement.count({ where: { tenantId: fx.tenant.id, idempotencyKey } });
    expect(count).toBe(1);
  });

  it('a duplicate direct issue with the same idempotency key posts only once', async () => {
    await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 20,
    });
    const idempotencyKey = randomUUID();

    const first = await service.recordIssue(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 5,
      idempotencyKey,
    });
    const second = await service.recordIssue(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 5,
      idempotencyKey,
    });

    expect(second.id).toBe(first.id);
    const available = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    expect(available.toNumber()).toBe(15); // debited once, not twice
  });

  it('same tenant + same key + a materially different request is rejected, not silently replayed', async () => {
    const idempotencyKey = randomUUID();
    await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 20,
      idempotencyKey,
    });

    // Same key, different quantity — a client bug (key reuse across two
    // different logical requests), not a retry. Must not return the
    // original 20-unit row as if it were this request's result.
    await expect(
      service.recordReceipt(fx.tenant.id, fx.user.id, {
        siteId: fx.site.id,
        materialId: fx.material.id,
        quantity: 99,
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // And nothing extra was posted — still exactly the original movement.
    const count = await prisma.stockMovement.count({ where: { tenantId: fx.tenant.id, idempotencyKey } });
    expect(count).toBe(1);
    const available = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    expect(available.toNumber()).toBe(20);
  });

  it('different tenants may reuse the same idempotency key independently', async () => {
    const idempotencyKey = randomUUID();
    const otherFx = await createTenantFixtures();
    try {
      const a = await service.recordReceipt(fx.tenant.id, fx.user.id, {
        siteId: fx.site.id,
        materialId: fx.material.id,
        quantity: 20,
        idempotencyKey,
      });
      const b = await service.recordReceipt(otherFx.tenant.id, otherFx.user.id, {
        siteId: otherFx.site.id,
        materialId: otherFx.material.id,
        quantity: 30,
        idempotencyKey,
      });
      expect(a.id).not.toBe(b.id); // two independent movements, not a cross-tenant collision
      expect(a.tenantId).toBe(fx.tenant.id);
      expect(b.tenantId).toBe(otherFx.tenant.id);
    } finally {
      await cleanupTenant(otherFx.tenant.id);
    }
  });

  it('tenant isolation: stock in tenant A is invisible when queried under tenant B', async () => {
    await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    const otherFx = await createTenantFixtures();
    try {
      const available = await service.getAvailableQuantity(otherFx.tenant.id, fx.site.id, fx.material.id);
      expect(available.toNumber()).toBe(0);
    } finally {
      await cleanupTenant(otherFx.tenant.id);
    }
  });

  // Requirement: "explicitly test the known direct Store Out concurrency
  // limitation... do NOT invent a new concurrency mechanism yet." This
  // deterministically forces the exact race described in
  // stock.service.ts's recordIssue docstring, rather than hoping timing
  // reproduces it — a real race is flaky to assert on by luck alone.
  it('KNOWN LIMITATION: two concurrent direct Store Outs can both pass the available-stock check and oversell', async () => {
    await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 10,
    });

    // Transaction A: reads "10 available", then PAUSES before writing —
    // simulating the window between A's read and A's commit, during which
    // B runs its own, fully independent transaction.
    let releaseA!: () => void;
    const aCanProceed = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let aHasRead = false;

    const txA = prisma.$transaction(async (tx) => {
      await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id, tx);
      aHasRead = true;
      await aCanProceed; // held open until B has already committed its own read+write
      return tx.stockMovement.create({
        data: {
          tenantId: fx.tenant.id,
          siteId: fx.site.id,
          materialId: fx.material.id,
          movementType: MovementType.ISSUE,
          quantity: 6,
          createdById: fx.user.id,
        },
      });
    });

    // Wait for A to have done its read (and only its read) before B starts.
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (aHasRead) {
          clearInterval(check);
          resolve();
        }
      }, 5);
    });

    // B: a complete, independent recordIssue call. Under Postgres Read
    // Committed, B cannot see A's uncommitted insert, so B also computes
    // "10 available" and its 6-unit issue passes the check too.
    const bResult = await service.recordIssue(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 6,
    });

    releaseA();
    await txA;

    // The bug, made concrete: 6 + 6 = 12 issued against only 10 available.
    // This is the exact scenario documented as a known, unfixed gap — see
    // stock.service.ts's recordIssue docstring and the PHASE A VALIDATION
    // REPORT for what a real fix (e.g. SELECT ... FOR UPDATE on a
    // dedicated per-site-per-material balance row, an advisory lock keyed
    // on (tenantId, siteId, materialId), or SERIALIZABLE isolation with
    // retry) would require.
    expect(bResult).toBeTruthy();
    const available = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    expect(available.toNumber()).toBe(-2); // stock is now negative — the actual defect
  });
});


describe('StockService.undoMovement — same-day undo (Phase B prerequisite)', () => {
  const service = new StockService();
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

  it('the original creator can undo a same-day receipt', async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    const undo = await service.undoMovement(fx.tenant.id, fx.user.id, receipt.id);
    expect(undo.reversalOfId).toBe(receipt.id);
    expect(undo.quantity.toNumber()).toBe(-50);

    const available = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    expect(available.toNumber()).toBe(0);
  });

  it('the original creator can undo a same-day direct issue', async () => {
    await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    const issue = await service.recordIssue(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 20,
    });
    const undo = await service.undoMovement(fx.tenant.id, fx.user.id, issue.id);
    expect(undo.reversalOfId).toBe(issue.id);
    expect(undo.quantity.toNumber()).toBe(-20);

    const available = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    expect(available.toNumber()).toBe(50); // back to pre-issue level
  });

  it("a different user cannot undo someone else's movement", async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    const otherUser = await prisma.user.create({
      data: {
        tenantId: fx.tenant.id,
        name: 'Other User',
        email: `other-${randomUUID()}@test.local`,
        passwordHash: 'unused-in-tests',
        role: Role.STOREKEEPER,
      },
    });
    await expect(
      service.undoMovement(fx.tenant.id, otherUser.id, receipt.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a movement cannot be undone on a later day (site-local, Asia/Yangon)', async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2); // safely across any timezone boundary
    const receipt = await prisma.stockMovement.create({
      data: {
        tenantId: fx.tenant.id,
        siteId: fx.site.id,
        materialId: fx.material.id,
        movementType: MovementType.RECEIPT,
        quantity: 50,
        createdById: fx.user.id,
        createdAt: twoDaysAgo,
      },
    });
    await expect(
      service.undoMovement(fx.tenant.id, fx.user.id, receipt.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a movement cannot be undone twice', async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    await service.undoMovement(fx.tenant.id, fx.user.id, receipt.id);
    await expect(
      service.undoMovement(fx.tenant.id, fx.user.id, receipt.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a reversal (compensating movement) cannot itself be undone', async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    const undo = await service.undoMovement(fx.tenant.id, fx.user.id, receipt.id);
    await expect(
      service.undoMovement(fx.tenant.id, fx.user.id, undo.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('the original movement row is never edited or deleted by an undo', async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    await service.undoMovement(fx.tenant.id, fx.user.id, receipt.id);
    const stillThere = await prisma.stockMovement.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(stillThere.quantity.toNumber()).toBe(50);
    expect(stillThere.reversalOfId).toBeNull();
    expect(stillThere.movementType).toBe(MovementType.RECEIPT);
  });

  it('the reversal relationship (reversalOfId / reversedBy) is stored correctly', async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    const undo = await service.undoMovement(fx.tenant.id, fx.user.id, receipt.id);
    const withReversals = await prisma.stockMovement.findUniqueOrThrow({
      where: { id: receipt.id },
      include: { reversedBy: true },
    });
    expect(withReversals.reversedBy).toHaveLength(1);
    expect(withReversals.reversedBy[0].id).toBe(undo.id);
    expect(undo.reversalOfId).toBe(receipt.id);
  });

  it('blocks undoing a receipt when doing so would leave stock negative', async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 100,
    });
    await service.recordIssue(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 80,
    });
    await expect(
      service.undoMovement(fx.tenant.id, fx.user.id, receipt.id),
    ).rejects.toBeInstanceOf(ConflictException);

    // Atomic rejection -- nothing changed.
    const available = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    expect(available.toNumber()).toBe(20); // 100 - 80, unaffected by the rejected undo
    const count = await prisma.stockMovement.count({
      where: { tenantId: fx.tenant.id, materialId: fx.material.id },
    });
    expect(count).toBe(2); // just the original receipt + issue, no compensating row
  });

  it('tenant isolation: a movement cannot be undone under a different tenant', async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    const otherFx = await createTenantFixtures();
    try {
      await expect(
        service.undoMovement(otherFx.tenant.id, otherFx.user.id, receipt.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      await cleanupTenant(otherFx.tenant.id);
    }
  });

  it("site isolation: undoing a movement at one site does not affect another site's stock", async () => {
    const otherSite = await prisma.site.create({
      data: { tenantId: fx.tenant.id, name: `Other Site ${randomUUID()}` },
    });
    await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: otherSite.id,
      materialId: fx.material.id,
      quantity: 30,
    });
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    await service.undoMovement(fx.tenant.id, fx.user.id, receipt.id);

    const thisSite = await service.getAvailableQuantity(fx.tenant.id, fx.site.id, fx.material.id);
    const otherSiteAvail = await service.getAvailableQuantity(fx.tenant.id, otherSite.id, fx.material.id);
    expect(thisSite.toNumber()).toBe(0);
    expect(otherSiteAvail.toNumber()).toBe(30); // untouched
  });

  it('a retried/double-tapped undo is safe -- only one compensating movement is ever created', async () => {
    const receipt = await service.recordReceipt(fx.tenant.id, fx.user.id, {
      siteId: fx.site.id,
      materialId: fx.material.id,
      quantity: 50,
    });
    const results = await Promise.allSettled([
      service.undoMovement(fx.tenant.id, fx.user.id, receipt.id),
      service.undoMovement(fx.tenant.id, fx.user.id, receipt.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const reversals = await prisma.stockMovement.count({ where: { reversalOfId: receipt.id } });
    expect(reversals).toBe(1);
  });
});
