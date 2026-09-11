import { Prisma, RequisitionStatus } from '@csp-erp/db';

export interface RequisitionLineForStatus {
  approvedQty: Prisma.Decimal | null;
  // SUM(StockMovement.quantity) for this line, ISSUE and any compensating
  // (negative-quantity) undo rows both included -- the ledger SUM already
  // nets a reversal out for free, so this is "issued so far, truthfully,
  // right now" with no special-casing needed by the caller.
  issuedQty: Prisma.Decimal;
}

// Single source of truth for "what should this requisition's status be,
// given the ledger's current truth for every line." Both RequisitionsService
// .issue() (a forward issue happened) and StockService.undoMovement() (an
// issue was undone) are the same question from this function's point of
// view -- "the ledger changed, recompute" -- so there is exactly one place
// this state-machine rule is expressed, not two copies that could drift.
// Never returns DRAFT/PENDING_APPROVAL/REJECTED/CANCELLED -- both callers
// only invoke this once a requisition is already APPROVED or later, so
// only the three post-approval outcomes are representable here.
export function computeIssuedStatus(
  lines: RequisitionLineForStatus[],
): typeof RequisitionStatus.APPROVED | typeof RequisitionStatus.PARTIALLY_ISSUED | typeof RequisitionStatus.ISSUED {
  let anyIssued = false;
  let allFullyIssued = true;
  for (const line of lines) {
    if (!line.approvedQty) continue; // a line the approver never set an approvedQty for -- excluded, same as the pre-existing issue() logic
    if (line.issuedQty.greaterThan(0)) anyIssued = true;
    if (line.issuedQty.lessThan(line.approvedQty)) allFullyIssued = false;
  }
  if (!anyIssued) return RequisitionStatus.APPROVED;
  return allFullyIssued ? RequisitionStatus.ISSUED : RequisitionStatus.PARTIALLY_ISSUED;
}
