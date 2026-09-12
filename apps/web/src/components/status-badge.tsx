import { STATUS_LABEL, type RequisitionStatus } from "@/lib/format";

// The existing token set (globals.css) has exactly three semantic pairs --
// success / warning / danger -- plus a neutral "chip" pair. There is no
// separate "info" semantic anywhere in this codebase, so PENDING_APPROVAL
// and CANCELLED intentionally reuse the neutral chip pair rather than
// inventing a new color, per this task's "use existing tokens exactly,
// don't introduce new semantic colors" rule.
const TONE: Record<RequisitionStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: "var(--chip)", fg: "var(--muted-2)" },
  PENDING_APPROVAL: { bg: "var(--chip)", fg: "var(--muted-2)" },
  APPROVED: { bg: "var(--success-bg)", fg: "var(--success)" },
  PARTIALLY_ISSUED: { bg: "var(--warning-bg)", fg: "var(--warning)" },
  ISSUED: { bg: "var(--success-bg)", fg: "var(--success)" },
  REJECTED: { bg: "var(--danger-bg)", fg: "var(--danger)" },
  CANCELLED: { bg: "var(--chip)", fg: "var(--muted-2)" },
};

export function StatusBadge({ status }: { status: string }) {
  const key = (status in TONE ? status : "PENDING_APPROVAL") as RequisitionStatus;
  const tone = TONE[key];
  return (
    <span
      className="inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {STATUS_LABEL[key]}
    </span>
  );
}
