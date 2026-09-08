# ADR-0001: ORM choice — Prisma vs Drizzle

## Status
Accepted (2026-09-08)

## Context
docs/full-scope-v1.md flags this as an open decision that must be made before
the first migration. Both `apps/api` (NestJS) and `packages/db` need a
concrete choice to unblock schema work.

## Options
1. **Prisma** — schema-first DSL (`schema.prisma`), generates a typed client,
   mature migration tooling (`prisma migrate dev`), large ecosystem, well-
   documented NestJS integration patterns. Downside: an extra generate step,
   and its query builder is less flexible for hand-tuned SQL than Drizzle's.
2. **Drizzle** — TypeScript-first, closer to raw SQL, no codegen step,
   generally faster cold start. Downside: younger migration tooling, fewer
   NestJS-specific examples, less precedent for the kind of stored-procedure-
   adjacent query tuning in Wyne's background.

## Decision
Prisma.

## Consequences
- `packages/db` gets `prisma` (dev) and `@prisma/client` (runtime) as
  dependencies. `packages/db/prisma/schema.prisma` becomes the single source
  of truth for the data model.
- Migrations run via `prisma migrate dev` (local) and `prisma migrate deploy`
  (prod) — no hand-written SQL unless Prisma can't express something.
- Known gap: Prisma's schema DSL has no native `CHECK` constraint support.
  `stock_movement`'s "exactly one of goods_receipt_line_id /
  requisition_line_id is set" constraint will need one raw-SQL migration
  step layered on top of a Prisma-generated migration, when that table is
  built (milestone 2/3).
- The generated client is build output, not source — `packages/db/generated/`
  (or wherever `prisma generate` targets) goes in `.gitignore`, not in git.
