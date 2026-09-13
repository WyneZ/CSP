"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime, isActiveStatus, requisitionRef } from "@/lib/format";

type Site = { id: string; name: string };
type Material = { id: string; code: string; name: string; unit: string };

// Shared list shape returned by GET /requisitions -- lines here are the
// raw RequisitionLine rows (no material include), which is all the list
// view needs (a count), not the detail view's per-line breakdown.
type Requisition = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  remarks: string | null;
  site: { name: string };
  requestedBy: { id: string; name: string };
  lines: { id: string }[];
};

type DraftLine = { materialId: string; requestedQty: string };

// ---------------------------------------------------------------------
// Phase 1 (unchanged): the original desktop table + inline create form,
// used as-is for every role except Site Engineer. Site Engineer now has
// a dedicated /requisitions/new (Screen 1) and a mobile My Requisitions
// view (Screen 3) below -- this branch is left exactly as it was so
// nothing about the Admin/Storekeeper/Viewer experience changes.
// ---------------------------------------------------------------------
function LegacyRequisitionsView({ user }: { user: { role: string } }) {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);

  const [siteId, setSiteId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ materialId: "", requestedQty: "" }]);
  const [error, setError] = useState<string | null>(null);

  const canRequest = user.role === "ADMIN" || user.role === "SITE_ENGINEER";

  async function load() {
    const [r, s, m] = await Promise.all([
      api.get<Requisition[]>("/requisitions"),
      api.get<Site[]>("/sites"),
      api.get<Material[]>("/materials"),
    ]);
    setRequisitions(r);
    setSites(s);
    setMaterials(m);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/requisitions", {
        siteId,
        lines: lines
          .filter((l) => l.materialId && l.requestedQty)
          .map((l) => ({ materialId: l.materialId, requestedQty: Number(l.requestedQty) })),
      });
      setSiteId("");
      setLines([{ materialId: "", requestedQty: "" }]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-bold">Requisitions</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">Date</th>
            <th className="py-2">Site</th>
            <th className="py-2">Requested by</th>
            <th className="py-2">Lines</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {requisitions.map((r) => (
            <tr key={r.id} className="border-b border-border-soft">
              <td className="py-2">{new Date(r.createdAt).toLocaleDateString()}</td>
              <td className="py-2">{r.site.name}</td>
              <td className="py-2">{r.requestedBy.name}</td>
              <td className="py-2">{r.lines.length}</td>
              <td className="py-2">
                <Link href={`/requisitions/${r.id}`} className="underline">
                  {r.status}
                </Link>
              </td>
            </tr>
          ))}
          {requisitions.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-muted">
                No requisitions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canRequest && (
        <form onSubmit={handleCreate} className="flex max-w-lg flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-medium">New requisition</h2>
          <select
            required
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="">Select site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {lines.map((line, i) => (
            <div key={i} className="flex gap-2">
              <select
                value={line.materialId}
                onChange={(e) => updateLine(i, { materialId: e.target.value })}
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="">Material…</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} — {m.name} ({m.unit})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Qty"
                value={line.requestedQty}
                onChange={(e) => updateLine(i, { requestedQty: e.target.value })}
                className="w-24 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { materialId: "", requestedQty: "" }])}
            className="self-start text-sm underline"
          >
            + add another material
          </button>

          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" className="self-start rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
            Create requisition
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Phase 2 Screen 3: My Requisitions (Site Engineer only).
// ---------------------------------------------------------------------
type ListState = "loading" | "error" | "ready";
type Filter = "active" | "all";

function EmptyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" />
    </svg>
  );
}

function MyRequisitionsView({ user }: { user: { id: string; role: string } }) {
  const router = useRouter();
  const [state, setState] = useState<ListState>("loading");
  const [all, setAll] = useState<Requisition[]>([]);
  const [filter, setFilter] = useState<Filter>("active");
  const [cancelTarget, setCancelTarget] = useState<Requisition | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setState("loading");
    try {
      const r = await api.get<Requisition[]>("/requisitions");
      // Exclude DRAFT: the one-step Submit flow (requisitions/new) never
      // shows Draft to the user and normally never leaves one behind, but
      // a network failure between create() and the immediately-following
      // submit() call can strand a real DRAFT row server-side (the two
      // are separate requests, not one atomic operation). Rather than let
      // a "Draft" badge leak onto a screen that must never show it (per
      // the fixed status vocabulary), it's filtered out here -- a stray
      // Draft self-heals the next time the engineer retries that same
      // submission (same idempotency key resolves it), so hiding it from
      // this list costs nothing.
      setAll(r.filter((req) => req.requestedBy.id === user.id && req.status !== "DRAFT"));
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = [...all].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const visible = filter === "active" ? mine.filter((r) => isActiveStatus(r.status)) : mine;

  async function confirmCancel() {
    if (!cancelTarget) return;
    setActionError(null);
    try {
      await api.post(`/requisitions/${cancelTarget.id}/cancel`);
      setCancelTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't cancel this request. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-16 md:mx-auto md:max-w-2xl md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">My Requisitions</h1>
        <button
          onClick={() => router.push("/requisitions/new")}
          className="hidden rounded-[10px] bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground md:block"
        >
          New Requisition
        </button>
      </div>

      <div className="flex gap-1.5 rounded-[10px] bg-chip p-1">
        {(["active", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`h-11 flex-1 rounded-lg text-[13px] font-semibold transition-colors ${
              filter === f ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {f === "active" ? "Active" : "All"}
          </button>
        ))}
      </div>

      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      {state === "loading" && <p className="text-sm text-muted">Loading your requests…</p>}

      {state === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-2">Couldn&apos;t load your requests. Check your connection and try again.</p>
          <button onClick={load} className="rounded-[10px] border border-border px-4 py-2 text-sm font-semibold text-foreground">
            Retry
          </button>
        </div>
      )}

      {state === "ready" && visible.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-8 text-center text-muted-2">
          <EmptyIcon />
          <p className="text-sm">
            {mine.length === 0
              ? "You haven't submitted any material requests yet."
              : "No active requests right now."}
          </p>
        </div>
      )}

      {state === "ready" && visible.length > 0 && (
        <div className="flex flex-col gap-3">
          {visible.map((r) => {
            const canCancel = r.status === "PENDING_APPROVAL";
            return (
              <div key={r.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
                <Link href={`/requisitions/${r.id}`} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold">{requisitionRef(r.id)}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="line-clamp-2 text-sm text-foreground">{r.remarks || "No purpose noted"}</p>
                  <p className="text-xs text-muted">
                    {r.lines.length} material{r.lines.length === 1 ? "" : "s"} &middot; updated {formatDateTime(r.updatedAt)}
                  </p>
                </Link>
                {/* Cancel is hidden (not disabled) once it stops being
                    possible -- there is nothing meaningful to disable-and-
                    explain once a request has moved past Pending Approval. */}
                {canCancel && (
                  <button
                    onClick={() => setCancelTarget(r)}
                    className="self-start text-sm font-semibold text-danger"
                  >
                    Cancel request
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card p-4 md:hidden">
        <button
          onClick={() => router.push("/requisitions/new")}
          className="flex h-14 w-full items-center justify-center rounded-[10px] bg-accent text-[16px] font-semibold text-accent-foreground"
        >
          New Requisition
        </button>
      </div>

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this request?"
        message={
          cancelTarget
            ? `${requisitionRef(cancelTarget.id)} will be cancelled and can no longer be approved. This can't be undone.`
            : ""
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        destructive
        onConfirm={confirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}

export default function RequisitionsPage() {
  const { user, loading } = useRequireAuth();

  if (loading || !user) return <p className="text-sm text-muted">Loading…</p>;

  if (user.role === "SITE_ENGINEER") {
    return <MyRequisitionsView user={user} />;
  }

  return <LegacyRequisitionsView user={user} />;
}
