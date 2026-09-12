// Phase 2 (Site Engineer workflow) shared formatting/status helpers.
//
// Deliberately NOT merged with stock/page.tsx's own inline formatQty /
// dateGroup / formatTime helpers, even though they overlap -- this task's
// rule is "don't redesign Phase 1 screens," and touching stock/page.tsx
// just to extract a shared helper isn't required for Phase 2 to work. A
// small duplication is the honest cost of leaving Phase 1 alone.

export type RequisitionStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PARTIALLY_ISSUED"
  | "ISSUED"
  | "REJECTED"
  | "CANCELLED";

// Fixed, closed status vocabulary -- the exact seven values the backend's
// RequisitionStatus enum implements today. DRAFT is included only because
// the API can technically still hand it back for a split second between
// create() and the one-step submit() that immediately follows it; no
// screen in this workflow ever intentionally shows it to a user (see
// requisitions/new/page.tsx). There is no separate "Closed" value -- ISSUED
// is the terminal state, labeled "Fully Issued" here (Phase 2 spec §13).
export const STATUS_LABEL: Record<RequisitionStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  PARTIALLY_ISSUED: "Partially Issued",
  ISSUED: "Fully Issued",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

// "Active" filter for My Requisitions (Phase 2 spec §8) -- anything that
// still has something left to happen.
export function isActiveStatus(status: string): boolean {
  return status !== "REJECTED" && status !== "CANCELLED" && status !== "ISSUED";
}

// Presentation-only human-readable reference -- the schema has no
// sequential requisition number (Phase 2 spec §7's documented convention).
// No schema change; purely a display transform of the existing UUID.
export function requisitionRef(id: string): string {
  return `REQ-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function formatQty(q: string | number): string {
  const n = typeof q === "number" ? q : Number(q);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : String(q);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
