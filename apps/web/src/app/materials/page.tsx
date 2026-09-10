"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";

type Material = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  unit: string;
  standardRate: string | null;
  currency: string;
};

type EditDraft = { name: string; category: string; unit: string; standardRate: string };

export default function MaterialsPage() {
  const { user, loading } = useRequireAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const canEdit = user?.role === "ADMIN" || user?.role === "SITE_ENGINEER";

  async function load() {
    setMaterials(await api.get<Material[]>("/materials"));
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/materials", { code, name, unit });
      setCode("");
      setName("");
      setUnit("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  function startEdit(m: Material) {
    setEditingId(m.id);
    setEditDraft({
      name: m.name,
      category: m.category ?? "",
      unit: m.unit,
      standardRate: m.standardRate ?? "",
    });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    setError(null);
    try {
      await api.patch(`/materials/${id}`, {
        name: editDraft.name,
        category: editDraft.category || undefined,
        unit: editDraft.unit,
        standardRate: editDraft.standardRate ? Number(editDraft.standardRate) : undefined,
      });
      setEditingId(null);
      setEditDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  if (loading || !user) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-bold">Materials</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">Code</th>
            <th className="py-2">Name</th>
            <th className="py-2">Unit</th>
            <th className="py-2">Rate</th>
            {canEdit && <th className="py-2"></th>}
          </tr>
        </thead>
        <tbody>
          {materials.map((m) =>
            editingId === m.id && editDraft ? (
              <tr key={m.id} className="border-b border-border-soft">
                <td className="py-2 text-muted">{m.code}</td>
                <td className="py-2">
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    className="w-full rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <input
                    value={editDraft.unit}
                    onChange={(e) => setEditDraft({ ...editDraft, unit: e.target.value })}
                    className="w-20 rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <input
                    type="number"
                    step="any"
                    value={editDraft.standardRate}
                    onChange={(e) => setEditDraft({ ...editDraft, standardRate: e.target.value })}
                    className="w-24 rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(m.id)} className="text-sm underline">
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditDraft(null);
                      }}
                      className="text-sm text-muted underline"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={m.id} className="border-b border-border-soft">
                <td className="py-2">{m.code}</td>
                <td className="py-2">{m.name}</td>
                <td className="py-2">{m.unit}</td>
                <td className="py-2">{m.standardRate ? `${m.standardRate} ${m.currency}` : "—"}</td>
                {canEdit && (
                  <td className="py-2">
                    <button onClick={() => startEdit(m)} className="text-sm underline">
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ),
          )}
          {materials.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-muted">
                No materials yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canEdit && (
        <form onSubmit={handleCreate} className="flex max-w-md flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-medium">Add material</h2>
          <input
            placeholder="Code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            placeholder="Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            placeholder="Unit (e.g. bag, kg, cft)"
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" className="self-start rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
            Add
          </button>
        </form>
      )}
    </div>
  );
}
