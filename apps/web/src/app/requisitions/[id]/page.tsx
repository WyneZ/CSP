"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime, formatQty, requisitionRef } from "@/lib/format";

type Line = {
  id: string;
  requestedQty: string;
  approvedQty: string | null;
  material: { id: string; code: string; name: string; unit: string };
};

type RequisitionDetail = {
  id: string;
  status: string;
  remarks: string | null;
  rejectedReason: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  site: { id: string; name: string };
  requestedBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
  lines: Line[];
};

// Raw ledger rows -- requisitionLineId and reversalOfId are present on
// every StockMovement returned by GET /stock/movements even though the
// backend's own narrower TS type on that route doesn't declare them
// (getMovementHistory has no `select`, so every column comes back). No
// actor name is included (no createdBy relation on that query) -- a real,
// flagged gap: Activity History below cannot attribute an issue/undo to a
// person, only to a time.
type Movement = {
  id: string;
  materialId: string;
  movementType: "RECEIPT" | "ISSUE";
  quantity: string;
  requisitionLineId: string | null;
  reversalOfId: string | null;
  createdAt: string;
};

type CurrentStockRow = { materialId: string; quantity: string };

type ActivityEntry = { key: string; text: string; time: string; tone?: "danger" };

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5 22 20.5H2Z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </svg>
  );
}

export default function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useRequireAuth();

  const [requisition, setRequisition] = useState<RequisitionDetail | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [currentStock, setCurrentStock] = useState<CurrentStockRow[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");

  const [approveQtys, setApproveQtys] = useState<Record<string, string>>({});
  const [issueQtys, setIssueQtys] = useState<Record<string, string>>({});

  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Phase A (unchanged from Phase 1): one idempotency key per issue
  // attempt across all lines in this submit. Reset whenever the entered
  // quantities change, so editing and resubmitting is a new attempt, not
  // a retry of the old one. Preserved exactly -- Phase 2 only restyles
  // this action, it does not touch its logic.
  const issueIdempotencyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    issueIdempotencyKeyRef.current = null;
  }, [issueQtys]);

  async function load() {
    setLoadState("loading");
    try {
      const r = await api.get<RequisitionDetail>(`/requisitions/${id}`);
      setRequisition(r);
      setApproveQtys(Object.fromEntries(r.lines.map((l) => [l.id, l.approvedQty ?? l.requestedQty])));

      const materialIds = [...new Set(r.lines.map((l) => l.material.id))];
      const [movementLists, stock] = await Promise.all([
        Promise.all(
          materialIds.map((materialId) =>
            api.get<Movement[]>(`/stock/movements?siteId=${r.site.id}&materialId=${materialId}`),
          ),
        ),
        api.get<CurrentStockRow[]>(`/stock/current?siteId=${r.site.id}`),
      ]);
      const lineIds = new Set(r.lines.map((l) => l.id));
      setMovements(movementLists.flat().filter((m) => m.requisitionLineId && lineIds.has(m.requisitionLineId)));
      setCurrentStock(stock);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  async function run(action: () => Promise<unknown>, onSuccess?: () => void) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onSuccess?.();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <p className="text-sm text-muted">Loading…</p>;
  if (loadState === "loading") return <p className="text-sm text-muted">Loading…</p>;
  if (loadState === "error" || !requisition) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-2">Couldn&apos;t load this request. Check your connection and try again.</p>
        <button onClick={load} className="rounded-[10px] border border-border px-4 py-2 text-sm font-semibold text-foreground">
          Retry
        </button>
      </div>
    );
  }

  const r = requisition;
  const canRequest = user.role === "ADMIN" || user.role === "SITE_ENGINEER";
  const canApprove = user.role === "ADMIN";
  const canIssue = user.role === "ADMIN" || user.role === "STOREKEEPER";

  function issuedQtyFor(lineId: string) {
    return movements
      .filter((m) => m.requisitionLineId === lineId)
      .reduce((sum, m) => sum + Number(m.quantity), 0);
  }

  function availableFor(materialId: string) {
    const row = currentStock.find((s) => s.materialId === materialId);
    return row ? Number(row.quantity) : 0;
  }

  const lineStats = r.lines.map((line) => {
    const requested = Number(line.requestedQty);
    const approved = line.approvedQty === null ? null : Number(line.approvedQty);
    const issued = issuedQtyFor(line.id);
    const remaining = approved === null ? null : Math.max(0, approved - issued);
    const available = availableFor(line.material.id);
    // Pre-approval, "requested" is what stock is measured against; once
    // approved, the approved quantity is the real commitment.
    const measureAgainst = approved ?? requested;
    const insufficient = available < measureAgainst;
    return { line, requested, approved, issued, remaining, available, insufficient };
  });

  const insufficientCount = lineStats.filter((s) => s.insufficient).length;

  // ---- Activity History --------------------------------------------
  const activity: ActivityEntry[] = [
    { key: "created", text: `Requested by ${r.requestedBy.name}`, time: r.createdAt },
  ];
  if (r.approvedAt && r.approvedBy) {
    activity.push({ key: "approved", text: `Approved by ${r.approvedBy.name}`, time: r.approvedAt });
  }
  if (r.status === "REJECTED") {
    activity.push({
      key: "rejected",
      text: r.rejectedReason ? `Rejected — ${r.rejectedReason}` : "Rejected",
      time: r.updatedAt,
      tone: "danger",
    });
  }
  if (r.status === "CANCELLED") {
    activity.push({ key: "cancelled", text: "Cancelled", time: r.updatedAt });
  }
  for (const m of movements) {
    const line = r.lines.find((l) => l.id === m.requisitionLineId);
    if (!line) continue;
    const qty = formatQty(Math.abs(Number(m.quantity)));
    activity.push(
      m.reversalOfId
        ? { key: m.id, text: `${qty} ${line.material.unit} issue undone — ${line.material.name}`, time: m.createdAt }
        : { key: m.id, text: `Issued ${qty} ${line.material.unit} — ${line.material.name}`, time: m.createdAt },
    );
  }
  activity.sort((a, b) => +new Date(a.time) - +new Date(b.time));

  async function attemptApprove() {
    if (insufficientCount > 0) {
      setApproveConfirmOpen(true);
      return;
    }
    await doApprove();
  }

  async function doApprove() {
    setApproveConfirmOpen(false);
    await run(() =>
      api.post(`/requisitions/${id}/approve`, {
        lines: r.lines.map((l) => ({
          lineId: l.id,
          approvedQty: Number(approveQtys[l.id] ?? l.requestedQty),
        })),
      }),
    );
  }

  async function doReject(reason?: string) {
    await run(() => api.post(`/requisitions/${id}/reject`, { reason }));
    setRejectOpen(false);
  }

  async function doCancel() {
    await run(() => api.post(`/requisitions/${id}/cancel`));
    setCancelOpen(false);
  }

  function attemptIssue() {
    if (!issueIdempotencyKeyRef.current) {
      issueIdempotencyKeyRef.current = crypto.randomUUID();
    }
    run(
      () =>
        api.post(`/requisitions/${id}/issue`, {
          idempotencyKey: issueIdempotencyKeyRef.current,
          lines: r.lines
            .filter((l) => Number(issueQtys[l.id] ?? 0) > 0)
            .map((l) => ({ lineId: l.id, quantity: Number(issueQtys[l.id]) })),
        }),
      // Success clears the key and the entered quantities -- the next
      // Issue click (partial-then-remainder, or a fresh correction) is a
      // new attempt with a new identity. On failure the key is kept so a
      // retry of this same click is recognized as the same attempt, not
      // double-posted.
      () => {
        issueIdempotencyKeyRef.current = null;
        setIssueQtys({});
      },
    );
  }

  const showApprovalArea = canApprove && r.status === "PENDING_APPROVAL";
  const showIssueArea = canIssue && (r.status === "APPROVED" || r.status === "PARTIALLY_ISSUED");
  const showCancel = canRequest && (r.status === "DRAFT" || r.status === "PENDING_APPROVAL");
  const showLegacySubmit = canRequest && r.status === "DRAFT";

  return (
    <div className="flex flex-col gap-6 pb-10 md:mx-auto md:max-w-2xl">
      {/* 1. Reference + status */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-base font-bold">{requisitionRef(r.id)}</span>
        <StatusBadge status={r.status} />
      </div>

      {/* 2. Request context */}
      <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4 text-sm">
        <p>
          <span className="text-muted-2">Site:</span> {r.site.name}
        </p>
        <p>
          <span className="text-muted-2">Requested by:</span> {r.requestedBy.name} &middot; {formatDateTime(r.createdAt)}
        </p>
        {r.approvedBy && (
          <p>
            <span className="text-muted-2">Approved by:</span> {r.approvedBy.name}
          </p>
        )}
        <p>
          <span className="text-muted-2">Purpose:</span> {r.remarks || "—"}
        </p>
        {/* The backend has no `neededBy` field on Requisition -- the UX
            spec's needed-by date is intentionally not rendered anywhere in
            this app rather than faked. */}
      </div>

      {/* 3 + 4. Quantity blocks and stock sufficiency, per line */}
      <div className="flex flex-col gap-3">
        {lineStats.map(({ line, requested, approved, issued, remaining, available, insufficient }) => (
          <div key={line.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">
              {line.material.code} — {line.material.name}
            </p>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <span className="text-muted-2">Requested</span>
              <span className="text-right font-mono text-sm font-semibold">
                {formatQty(requested)} <span className="text-xs font-medium text-muted">{line.material.unit}</span>
              </span>

              <span className="text-muted-2">Approved</span>
              <span className="text-right font-mono text-sm font-semibold">
                {approved === null ? (
                  "—"
                ) : (
                  <>
                    {formatQty(approved)} <span className="text-xs font-medium text-muted">{line.material.unit}</span>
                  </>
                )}
              </span>

              {approved !== null && (
                <>
                  <span className="text-muted-2">Already issued</span>
                  <span className="text-right font-mono text-sm font-semibold">
                    {formatQty(issued)} <span className="text-xs font-medium text-muted">{line.material.unit}</span>
                  </span>

                  <span className="text-muted-2">Remaining</span>
                  <span className="text-right font-mono text-base font-bold">
                    {formatQty(remaining ?? 0)} <span className="text-xs font-medium text-muted">{line.material.unit}</span>
                  </span>
                </>
              )}
            </div>

            {/* Available Stock is kept visually separate (a divider +
                muted block) from the lifecycle quantities above -- it is
                current physical stock, not part of this request's
                history, and conflating the two is exactly what the Phase 2
                spec warns against. */}
            <div className="flex items-center justify-between border-t border-border-soft pt-2 text-sm">
              <span className="text-muted-2">Available stock</span>
              <span className="font-mono text-sm font-semibold">
                {formatQty(available)} <span className="text-xs font-medium text-muted">{line.material.unit}</span>
              </span>
            </div>

            {insufficient && (
              <div
                className="flex items-start gap-2 rounded-lg p-3 text-sm"
                style={{ background: "var(--warning-bg)", color: "var(--warning)" }}
              >
                <WarningIcon />
                <p>
                  {formatQty(available)} {line.material.unit} available, {formatQty(approved ?? requested)}{" "}
                  {line.material.unit} {approved !== null ? "approved" : "requested"}. This doesn&apos;t stop the
                  request — the storekeeper will issue what&apos;s on hand now, and the rest stays open until more
                  stock arrives.
                </p>
              </div>
            )}

            {showApprovalArea && (
              <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
                Approved quantity
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={approveQtys[line.id] ?? ""}
                  onChange={(e) => setApproveQtys((prev) => ({ ...prev, [line.id]: e.target.value }))}
                  className="h-14 rounded-[10px] border-[1.5px] border-border bg-card px-3.5 font-mono text-base font-bold outline-none focus:border-accent"
                />
              </label>
            )}

            {showIssueArea && (
              <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
                Issue now
                <div className="flex h-14 items-center gap-2 rounded-[10px] border-[1.5px] border-border bg-card px-3.5 focus-within:border-accent">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={issueQtys[line.id] ?? ""}
                    onChange={(e) => setIssueQtys((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    className="w-full bg-transparent font-mono text-lg font-bold outline-none"
                  />
                  <span className="rounded-md bg-chip px-2 py-1 text-xs font-semibold text-muted-2">
                    {line.material.unit}
                  </span>
                </div>
              </label>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* 5. Decision state / action */}
      <div className="flex flex-col gap-3">
        {showLegacySubmit && (
          <button
            disabled={busy}
            onClick={() => run(() => api.post(`/requisitions/${id}/submit`))}
            className="flex h-14 items-center justify-center rounded-[10px] bg-accent text-[16px] font-semibold text-accent-foreground disabled:opacity-40"
          >
            Submit for approval
          </button>
        )}

        {showApprovalArea && (
          <div className="flex flex-col gap-2">
            <button
              disabled={busy}
              onClick={attemptApprove}
              className="flex h-14 items-center justify-center rounded-[10px] text-[16px] font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--success)" }}
            >
              {busy ? "Approving…" : "Approve"}
            </button>
            <button
              disabled={busy}
              onClick={() => setRejectOpen(true)}
              className="flex h-14 items-center justify-center rounded-[10px] border border-border text-[16px] font-semibold text-danger disabled:opacity-40"
            >
              {busy ? "Rejecting…" : "Reject"}
            </button>
          </div>
        )}

        {showIssueArea && (
          <button
            disabled={busy}
            onClick={attemptIssue}
            className="flex h-14 items-center justify-center rounded-[10px] text-[16px] font-semibold text-white disabled:opacity-40"
            style={{ background: "var(--warning)" }}
          >
            {busy ? "Issuing…" : "Issue"}
          </button>
        )}
      </div>

      {/* 7. Cancel, when eligible -- placed directly below the action
          area and above Activity History per the Phase 2 visual
          refinement decision package (DOM/layout reorder only, no
          permission or behavior change). */}
      {showCancel && (
        <button
          disabled={busy}
          onClick={() => setCancelOpen(true)}
          className="self-start text-sm font-semibold text-danger disabled:opacity-40"
        >
          Cancel request
        </button>
      )}

      {/* 6. Activity history */}
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-bold">Activity</h2>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
          {activity.map((entry) => (
            <div key={entry.key} className="flex items-baseline justify-between gap-3 text-sm">
              <span className={entry.tone === "danger" ? "text-danger" : "text-foreground"}>{entry.text}</span>
              <span className="shrink-0 text-xs text-muted">{formatDateTime(entry.time)}</span>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={approveConfirmOpen}
        title="Approve with limited stock?"
        message={`${requisitionRef(r.id)} — stock is currently below the requested quantity on ${insufficientCount} line${
          insufficientCount === 1 ? "" : "s"
        }. You can approve now — the storekeeper will issue what's available, and the rest stays open until more stock arrives.`}
        confirmLabel="Approve anyway"
        cancelLabel="Cancel"
        onConfirm={doApprove}
        onCancel={() => setApproveConfirmOpen(false)}
      />

      <ConfirmDialog
        open={rejectOpen}
        title="Reject this request?"
        message="The requester will see this reason. This can't be undone."
        confirmLabel="Reject request"
        cancelLabel="Keep pending"
        destructive
        requireText={{ label: "Reason for rejection", placeholder: "Why is this being rejected?" }}
        onConfirm={(text) => doReject(text)}
        onCancel={() => setRejectOpen(false)}
      />

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this request?"
        message={`${requisitionRef(r.id)} will be cancelled and can no longer be approved. This can't be undone.`}
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        destructive
        onConfirm={doCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}
