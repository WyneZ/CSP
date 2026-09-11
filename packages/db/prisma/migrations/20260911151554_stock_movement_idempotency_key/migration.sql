-- Phase A (inventory correctness): retry-safe writes for Store In / Store
-- Out / requisition-issue. A client-generated key lets a resubmitted
-- request (network retry, double-tap) be recognized as a duplicate instead
-- of posting a second ledger row.
--
-- Nullable: existing rows and any future server-originated movements have
-- no key. Postgres treats NULL values as distinct under a UNIQUE
-- constraint, so multiple NULLs are allowed here by design — the
-- constraint only rejects a *repeated* non-null key within the same tenant.
ALTER TABLE "stock_movement" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "stock_movement_tenantId_idempotencyKey_key" ON "stock_movement"("tenantId", "idempotencyKey");
