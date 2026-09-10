"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";

type Site = { id: string; name: string };
type Material = { id: string; code: string; name: string; unit: string };
type Requisition = {
  id: string;
  status: string;
  createdAt: string;
  site: { name: string };
  requestedBy: { name: string };
  lines: { id: string }[];
};

type DraftLine = { materialId: string; requestedQty: string };

export default function RequisitionsPage() {
  const { user, loading } = useRequireAuth();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);

  const [siteId, setSiteId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ materialId: "", requestedQty: "" }]);
  const [error, setError] = useState<string | null>(null);

  const canRequest = user?.role === "ADMIN" || user?.role === "SITE_ENGINEER";

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
    if (user) load();
  }, [user]);

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

  if (loading || !user) return <p className="text-sm text-muted">Loading…</p>;

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
