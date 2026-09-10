"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";

type Site = { id: string; name: string };
type Material = { id: string; code: string; name: string; unit: string; reorderLevel: string | null };
type CurrentStockRow = { siteId: string; materialId: string; quantity: string };
type Movement = {
  id: string;
  siteId: string;
  materialId: string;
  movementType: "RECEIPT" | "ISSUE";
  quantity: string;
  remarks: string | null;
  createdAt: string;
};

type Tab = "current" | "record" | "history";
type RecordType = "receipts" | "issues";

function formatQty(q: string) {
  const n = Number(q);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : q;
}

function dateGroup(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function SegmentedTabs({ tab, onChange, showRecord }: { tab: Tab; onChange: (t: Tab) => void; showRecord: boolean }) {
  const items: { key: Tab; label: string }[] = [{ key: "current", label: "Current" }];
  if (showRecord) items.push({ key: "record", label: "Record" });
  items.push({ key: "history", label: "History" });
  return (
    <div className="flex gap-1.5 rounded-[10px] bg-chip p-1">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={`flex-1 rounded-lg py-2 text-[13px] font-semibold transition-colors ${
            tab === it.key ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function StockPageInner() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sites, setSites] = useState<Site[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [current, setCurrent] = useState<CurrentStockRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  const canRecord = user?.role === "ADMIN" || user?.role === "STOREKEEPER";

  const initialTab = (searchParams.get("tab") as Tab) ?? "current";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [recordType, setRecordType] = useState<RecordType>((searchParams.get("type") as RecordType) ?? "receipts");

  useEffect(() => {
    if (user && tab === "record" && !canRecord) setTab("current");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, canRecord]);

  const [siteFilter, setSiteFilter] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [historyMaterialFilter, setHistoryMaterialFilter] = useState("");

  const [siteId, setSiteId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;
  const materialById = (id: string) => materials.find((m) => m.id === id);

  async function loadAll() {
    const [s, m, c, h] = await Promise.all([
      api.get<Site[]>("/sites"),
      api.get<Material[]>("/materials"),
      api.get<CurrentStockRow[]>("/stock/current"),
      api.get<Movement[]>("/stock/movements"),
    ]);
    setSites(s);
    setMaterials(m);
    setCurrent(c);
    setMovements([...h].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)));
  }

  useEffect(() => {
    if (user) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function changeTab(next: Tab) {
    setTab(next);
    router.replace(next === "current" ? "/stock" : `/stock?tab=${next}`);
  }

  async function submitRecord() {
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/stock/${recordType}`, {
        siteId,
        materialId,
        quantity: Number(quantity),
        remarks: remarks || undefined,
      });
      setQuantity("");
      setRemarks("");
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const currentRows = useMemo(() => {
    return current
      .filter((row) => !siteFilter || row.siteId === siteFilter)
      .map((row) => {
        const material = materialById(row.materialId);
        return { row, material };
      })
      .filter(({ material }) => {
        if (!materialSearch) return true;
        const q = materialSearch.toLowerCase();
        return material ? material.code.toLowerCase().includes(q) || material.name.toLowerCase().includes(q) : true;
      })
      .sort((a, b) => (a.material?.name ?? "").localeCompare(b.material?.name ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, materials, siteFilter, materialSearch]);

  const historyRows = useMemo(() => {
    return movements.filter((mv) => !historyMaterialFilter || mv.materialId === historyMaterialFilter);
  }, [movements, historyMaterialFilter]);

  const historyGroups = useMemo(() => {
    const groups: { label: string; rows: Movement[] }[] = [];
    for (const mv of historyRows) {
      const label = dateGroup(mv.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.rows.push(mv);
      else groups.push({ label, rows: [mv] });
    }
    return groups;
  }, [historyRows]);

  const recentEntries = movements.slice(0, 2);
  const selectedMaterial = materialById(materialId);

  if (loading || !user) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Stock</h1>
      <SegmentedTabs tab={tab} onChange={changeTab} showRecord={canRecord} />

      {tab === "current" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="h-11 rounded-[10px] border border-border bg-card px-3 text-sm sm:w-56"
            >
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div className="flex h-11 flex-1 items-center gap-2 rounded-[10px] border-[1.5px] border-border bg-background px-3">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="var(--muted-2)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m20 20-4.5-4.5" />
              </svg>
              <input
                value={materialSearch}
                onChange={(e) => setMaterialSearch(e.target.value)}
                placeholder="Search materials…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </div>
          </div>

          <div className="flex flex-col">
            {currentRows.map(({ row, material }) => {
              const qty = Number(row.quantity);
              const low = material?.reorderLevel != null && qty < Number(material.reorderLevel);
              return (
                <div
                  key={`${row.siteId}:${row.materialId}`}
                  className="flex items-center justify-between border-b border-border-soft py-3.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-xs text-muted">{material?.code ?? row.materialId}</span>
                    <span className="text-sm font-semibold">{material?.name ?? "Unknown material"}</span>
                    <span className="text-xs text-muted">{siteName(row.siteId)}</span>
                    {low && (
                      <span className="mt-0.5 w-fit rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
                        Low stock
                      </span>
                    )}
                  </div>
                  <div className={`font-mono text-base font-bold ${low ? "text-danger" : "text-foreground"}`}>
                    {formatQty(row.quantity)} <span className="text-xs font-medium text-muted">{material?.unit}</span>
                  </div>
                </div>
              );
            })}
            {currentRows.length === 0 && <p className="py-6 text-sm text-muted">No stock movements yet.</p>}
          </div>
        </div>
      )}

      {tab === "record" && canRecord && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-1.5 rounded-[10px] bg-chip p-1">
            <button
              onClick={() => setRecordType("receipts")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-semibold ${
                recordType === "receipts" ? "bg-success text-white" : "text-muted"
              }`}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v14" />
                <path d="m6 12 6 6 6-6" />
              </svg>
              Store In
            </button>
            <button
              onClick={() => setRecordType("issues")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-semibold ${
                recordType === "issues" ? "bg-warning text-white" : "text-muted"
              }`}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20V6" />
                <path d="m6 12 6-6 6 6" />
              </svg>
              Store Out
            </button>
          </div>

          <div className="flex max-w-md flex-col gap-3.5">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
              Site
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="h-[50px] rounded-[10px] border-[1.5px] border-border bg-card px-3.5 text-[15px]"
              >
                <option value="">Select site…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
              Material
              <select
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
                className="h-[50px] rounded-[10px] border-[1.5px] border-border bg-card px-3.5 text-[15px]"
              >
                <option value="">Select material…</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} — {m.name} ({m.unit})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
              Quantity
              <div
                className="flex h-14 items-center gap-2 rounded-[10px] border-[1.5px] bg-card px-3.5"
                style={{ borderColor: recordType === "receipts" ? "var(--success)" : "var(--warning)" }}
              >
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full bg-transparent font-mono text-lg font-bold outline-none"
                />
                {selectedMaterial && (
                  <span className="rounded-md bg-chip px-2 py-1 text-xs font-semibold text-muted-2">
                    {selectedMaterial.unit}
                  </span>
                )}
              </div>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
              Remarks (optional)
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                className="rounded-[10px] border-[1.5px] border-border bg-card px-3.5 py-3 text-sm outline-none"
              />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              onClick={submitRecord}
              disabled={!siteId || !materialId || !quantity || submitting}
              className="flex h-14 items-center justify-center gap-2 rounded-[10px] text-[16px] font-semibold text-white disabled:opacity-40"
              style={{ background: recordType === "receipts" ? "var(--success)" : "var(--warning)" }}
            >
              {recordType === "receipts" ? "Store In" : "Store Out"}
            </button>

            {recentEntries.length > 0 && (
              <div className="mt-2 flex flex-col gap-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Recent entries</span>
                {recentEntries.map((mv) => {
                  const material = materialById(mv.materialId);
                  const isReceipt = mv.movementType === "RECEIPT";
                  return (
                    <div key={mv.id} className="flex items-center gap-2.5">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        style={{
                          background: isReceipt ? "var(--success-bg)" : "var(--warning-bg)",
                          color: isReceipt ? "var(--success)" : "var(--warning)",
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          {isReceipt ? <path d="M12 4v14" /> : <path d="M12 20V6" />}
                          {isReceipt ? <path d="m6 12 6 6 6-6" /> : <path d="m6 12 6-6 6 6" />}
                        </svg>
                      </span>
                      <span className="flex-1 text-[13px]">
                        <span className="font-mono font-bold" style={{ color: isReceipt ? "var(--success)" : "var(--warning)" }}>
                          {isReceipt ? "+" : "−"}
                          {formatQty(mv.quantity)} {material?.unit}
                        </span>{" "}
                        {material?.name}
                      </span>
                      <span className="text-[11px] text-muted">{formatTime(mv.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="flex flex-col gap-3">
          <select
            value={historyMaterialFilter}
            onChange={(e) => setHistoryMaterialFilter(e.target.value)}
            className="h-11 self-start rounded-[10px] border border-border bg-card px-3 text-sm"
          >
            <option value="">All materials</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </select>

          <div className="flex flex-col">
            {historyGroups.map((group) => (
              <div key={group.label} className="flex flex-col">
                <div className="border-t border-border-soft pt-3 text-[11px] font-bold uppercase tracking-wide text-muted first:border-t-0 first:pt-0">
                  {group.label}
                </div>
                {group.rows.map((mv) => {
                  const material = materialById(mv.materialId);
                  const isReceipt = mv.movementType === "RECEIPT";
                  return (
                    <div key={mv.id} className="flex items-start gap-3 py-3">
                      <span
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        style={{
                          background: isReceipt ? "var(--success-bg)" : "var(--warning-bg)",
                          color: isReceipt ? "var(--success)" : "var(--warning)",
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          {isReceipt ? <path d="M12 4v14" /> : <path d="M12 20V6" />}
                          {isReceipt ? <path d="m6 12 6 6 6-6" /> : <path d="m6 12 6-6 6 6" />}
                        </svg>
                      </span>
                      <div className="flex flex-1 flex-col gap-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold">{material?.name ?? "Unknown material"}</span>
                          <span
                            className="font-mono text-sm font-bold"
                            style={{ color: isReceipt ? "var(--success)" : "var(--warning)" }}
                          >
                            {isReceipt ? "+" : "−"}
                            {formatQty(mv.quantity)} {material?.unit}
                          </span>
                        </div>
                        <span className="text-xs text-muted">{mv.remarks ?? "—"}</span>
                        <span className="text-xs text-muted">
                          {material?.code ?? mv.materialId} &middot; {siteName(mv.siteId)} &middot; {formatTime(mv.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {historyGroups.length === 0 && <p className="py-6 text-sm text-muted">No movements yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <StockPageInner />
    </Suspense>
  );
}
