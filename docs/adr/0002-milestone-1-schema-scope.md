# ADR-0002: Milestone-1 schema scope (walking skeleton)

## Status
Accepted (2026-09-08)

## Context
The full v1 schema (13 tables — see the "Store & Requisition Schema"
diagram) covers Goods Receipt and Requisition end-to-end. Milestone 1 only
needs to prove: log in, add a material, record a store-in, see stock.
Building all 13 tables now front-loads work this milestone doesn't exercise,
against the working agreement's own rule: one task = one vertical slice.

## Options
1. **Build all 13 tables now.** No re-migration later, but Vendor,
   Requisition/RequisitionLine/RequisitionStatusHistory, and
   MaterialUnitConversion sit untested and unused until milestone 2/3.
2. **Build a 5-table slice: Tenant, User, Site, Material, StockMovement.**
   - `Material` gets a plain `unit` string column instead of the full
     `Unit` + `MaterialUnitConversion` tables — conversion logic isn't
     exercised until the Store loop (milestone 2).
   - `StockMovement` supports `RECEIPT` only for now. No
     `goods_receipt_line_id` / `requisition_line_id` columns yet — those
     arrive with the tables they reference, in milestone 2/3's migrations.

## Decision
Option 2 — approved.

## Consequences
- Two further migrations are expected, not a surprise:
  - Milestone 2 adds `Vendor`, `GoodsReceipt`, `GoodsReceiptLine`, `Unit`,
    `MaterialUnitConversion`; widens `StockMovement`.
  - Milestone 3 adds `Requisition`, `RequisitionLine`,
    `RequisitionStatusHistory`.
- `Material.unit` (string) becomes `Material.baseUnitId` (FK) in the
  milestone-2 migration — an actual column change on an existing table,
  not just an addition. Flagging now so it isn't a surprise later.
- Schema foundations still apply in full at this scope: `tenant_id` +
  audit columns on every table, `StockMovement` append-only (created_at /
  created_by only), quantity as `Decimal`.
