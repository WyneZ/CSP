// Shared setup/teardown for the Phase A integration specs. Real
// integration tests, not mocks: StockService and RequisitionsService both
// use the @csp-erp/db singleton directly (see packages/db/src/index.ts's
// comment on why), so there's no Prisma client to substitute — these tests
// need a live Postgres, same DATABASE_URL the app itself uses (see
// src/test-setup-env.ts for how that gets loaded).
import { randomUUID } from 'node:crypto';
import { prisma, Role } from '@csp-erp/db';

export async function createTenantFixtures() {
  // Each call gets its own tenant, so tests (including ones that run
  // concurrently under Jest's worker pool) never see each other's rows,
  // and cleanup is "delete everything under this tenantId" rather than
  // truncating shared tables between tests.
  const tenant = await prisma.tenant.create({
    data: { name: `Test Tenant ${randomUUID()}` },
  });
  // Not a real bcrypt hash — these tests never authenticate, they call
  // service methods directly, so no password is ever checked. Avoids
  // pulling in bcrypt's native binding just for fixture setup.
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: 'Test User',
      email: `user-${randomUUID()}@test.local`,
      passwordHash: 'unused-in-tests',
      role: Role.STOREKEEPER,
    },
  });
  const site = await prisma.site.create({
    data: { tenantId: tenant.id, name: `Test Site ${randomUUID()}` },
  });
  const material = await prisma.material.create({
    data: {
      tenantId: tenant.id,
      code: `MAT-${randomUUID().slice(0, 8)}`,
      name: 'Test Material',
      unit: 'kg',
    },
  });
  return { tenant, user, site, material };
}

export async function cleanupTenant(tenantId: string) {
  // Hard delete, test-only — the real app never does this (soft deletes,
  // per the schema foundations rule). Children before parents: nothing
  // here relies on cascading deletes because the schema doesn't define
  // any (ON DELETE is unset, so leaving a child behind would just fail
  // the parent's delete with a live FK — ordering avoids that instead of
  // masking it).
  await prisma.stockMovement.deleteMany({ where: { tenantId } });
  await prisma.requisitionLine.deleteMany({ where: { requisition: { tenantId } } });
  await prisma.requisition.deleteMany({ where: { tenantId } });
  await prisma.material.deleteMany({ where: { tenantId } });
  await prisma.site.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}
