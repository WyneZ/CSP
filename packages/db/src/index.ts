// Singleton PrismaClient — avoids exhausting Postgres connections when
// apps/api's dev server hot-reloads (each reload would otherwise spin up a
// fresh client if this weren't cached on `global`).
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

// Named re-exports, not `export *`: a wildcard re-export of @prisma/client's
// generated entrypoint has been seen to drop this file's own named export
// (`prisma` above) under Node's CJS/ESM interop — a static, named list here
// isn't subject to that. Enums and `Prisma`/`PrismaClient` are runtime
// values (used as e.g. Role.ADMIN, Prisma.Decimal), so they're real
// exports, not `export type` — model shapes are types only.
export { PrismaClient, Prisma, Role, SiteStatus, MovementType, RequisitionStatus } from "@prisma/client";
export type {
  Tenant,
  User,
  Site,
  Material,
  StockMovement,
  Vendor,
  Requisition,
  RequisitionLine,
} from "@prisma/client";
