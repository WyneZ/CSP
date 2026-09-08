# @csp-erp/db

ORM: **Prisma** — see `docs/adr/0001-orm-choice.md`.

Schema scope: milestone-1 walking skeleton (5 tables) — see
`docs/adr/0002-milestone-1-schema-scope.md`. `prisma/schema.prisma` is
written for that scope only; Vendor, GoodsReceipt(+Line), Unit,
MaterialUnitConversion, Requisition(+Line, +StatusHistory) all arrive in
later migrations, on purpose.

## First run
```
pnpm install                              # from repo root, pulls prisma + @prisma/client
docker compose up -d                      # starts local postgres
pnpm --filter @csp-erp/db migrate:dev     # creates the DB tables, generates the client
```

`packages/db/.env` holds `DATABASE_URL` (gitignored, matches
`docker-compose.yml`'s local defaults) — Prisma reads it from here, not the
repo-root `.env`.
