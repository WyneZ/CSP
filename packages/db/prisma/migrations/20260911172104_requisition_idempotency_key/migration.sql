ALTER TABLE "requisition" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "requisition_tenantId_idempotencyKey_key" ON "requisition"("tenantId", "idempotencyKey");
