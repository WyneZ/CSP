"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";

type Line = {
  id: string;
  requestedQty: string;
  approvedQty: string | null;
  material: { code: string; name: string; unit: string };
};

type RequisitionDetail = {
  id: string;
  status: string;
  remarks: string | null;
  rejectedReason: string | null;
  site: { name: string };
  requestedBy: { name: string };
  approvedBy: { name: string } | null;
  lines: Line[];
};

export default function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useRequireAuth();
  const [requisition, setRequisition] = useState<RequisitionDetail | null>(null);
  const [approveQtys, setApproveQtys] = useState<Record<string, string>>({});
  const [issueQtys, setIssueQtys] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api.get<RequisitionDetail>(`/requisitions/${id}`);
    setRequisition(r);
    setApproveQtys(Object.fromEntries(r.lines.map((l) => [l.id, l.requestedQty])));
  }

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user || !requisition) return <p className="text-sm text-muted">Loading…</p>;

  const canRequest = user.role === "ADMIN" || user.role === "SITE_ENGINEER";
  const canApprove = user.role === "ADMIN";
  const canIssue = user.role === "ADMIN" || user.role === "STOREKEEPER";
  const r = requisition;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Requisition — {r.site.name}</h1>
        <p className="text-sm text-muted">
          Requested by {r.requestedBy.name} · Status: <span className="font-medium">{r.status}</span>
          {r.approvedBy && <> · Approved by {r.approvedBy.name}</>}
        </p>
        {r.rejectedReason && <p className="text-sm text-danger">Rejected: {r.rejectedReason}</p>}
        {r.remarks && <p className="text-sm text-muted">Remarks: {r.remarks}</p>}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">Material</th>
            <th className="py-2">Requested</th>
            <th className="py-2">Approved</th>
            {r.status === "PENDING_APPROVAL" && canApprove && <th className="py-2">Set approved qty</th>}
            {(r.status === "APPROVED" || r.status === "PARTIALLY_ISSUED") && canIssue && (
              <th className="py-2">Issue now</th>
            )}
          </tr>
        </thead>
        <tbody>
          {r.lines.map((line) => (
            <tr key={line.id} className="border-b border-border-soft">
              <td className="py-2">
                {line.material.code} — {line.material.name} ({line.material.unit})
              </td>
              <td className="py-2">{line.requestedQty}</td>
              <td className="py-2">{line.approvedQty ?? "—"}</td>
              {r.status === "PENDING_APPROVAL" && canApprove && (
                <td className="py-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={approveQtys[line.id] ?? ""}
                    onChange={(e) => setApproveQtys((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    className="w-24 rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
              )}
              {(r.status === "APPROVED" || r.status === "PARTIALLY_ISSUED") && canIssue && (
                <td className="py-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={issueQtys[line.id] ?? ""}
                    onChange={(e) => setIssueQtys((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    className="w-24 rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {r.status === "DRAFT" && canRequest && (
          <button
            disabled={busy}
            onClick={() => run(() => api.post(`/requisitions/${id}/submit`))}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
          >
            Submit for approval
          </button>
        )}

        {(r.status === "DRAFT" || r.status === "PENDING_APPROVAL") && canRequest && (
          <button
            disabled={busy}
            onClick={() => run(() => api.post(`/requisitions/${id}/cancel`))}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-chip"
          >
            Cancel requisition
          </button>
        )}

        {r.status === "PENDING_APPROVAL" && canApprove && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                run(() =>
                  api.post(`/requisitions/${id}/approve`, {
                    lines: r.lines.map((l) => ({
                      lineId: l.id,
                      approvedQty: Number(approveQtys[l.id] ?? l.requestedQty),
                    })),
                  }),
                )
              }
              className="rounded-lg bg-success px-3 py-2 text-sm font-medium text-white"
            >
              Approve
            </button>
            <div className="flex items-center gap-2">
              <input
                placeholder="Rejection reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                disabled={busy || !rejectReason}
                onClick={() => run(() => api.post(`/requisitions/${id}/reject`, { reason: rejectReason }))}
                className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          </>
        )}

        {(r.status === "APPROVED" || r.status === "PARTIALLY_ISSUED") && canIssue && (
          <button
            disabled={busy}
            onClick={() =>
              run(() =>
                api.post(`/requisitions/${id}/issue`, {
                  lines: r.lines
                    .filter((l) => Number(issueQtys[l.id] ?? 0) > 0)
                    .map((l) => ({ lineId: l.id, quantity: Number(issueQtys[l.id]) })),
                }),
              )
            }
            className="rounded-lg bg-warning px-3 py-2 text-sm font-medium text-white"
          >
            Issue
          </button>
        )}
      </div>
    </div>
  );
}
