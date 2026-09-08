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

export * from "@prisma/client";
