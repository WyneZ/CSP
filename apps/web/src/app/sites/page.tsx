"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";

type SiteStatus = "ACTIVE" | "ON_HOLD" | "COMPLETED";

type Site = {
  id: string;
  name: string;
  client: string | null;
  location: string | null;
  status: SiteStatus;
};

type EditDraft = { name: string; client: string; location: string; status: SiteStatus };

export default function SitesPage() {
  const { user, loading } = useRequireAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const canEdit = user?.role === "ADMIN" || user?.role === "SITE_ENGINEER";

  async function load() {
    setSites(await api.get<Site[]>("/sites"));
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/sites", { name, client: client || undefined, location: location || undefined });
      setName("");
      setClient("");
      setLocation("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  function startEdit(s: Site) {
    setEditingId(s.id);
    setEditDraft({ name: s.name, client: s.client ?? "", location: s.location ?? "", status: s.status });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    setError(null);
    try {
      await api.patch(`/sites/${id}`, {
        name: editDraft.name,
        client: editDraft.client || undefined,
        location: editDraft.location || undefined,
        status: editDraft.status,
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
      <h1 className="text-xl font-bold">Sites</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">Name</th>
            <th className="py-2">Client</th>
            <th className="py-2">Location</th>
            <th className="py-2">Status</th>
            {canEdit && <th className="py-2"></th>}
          </tr>
        </thead>
        <tbody>
          {sites.map((s) =>
            editingId === s.id && editDraft ? (
              <tr key={s.id} className="border-b border-border-soft">
                <td className="py-2">
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    className="w-full rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <input
                    value={editDraft.client}
                    onChange={(e) => setEditDraft({ ...editDraft, client: e.target.value })}
                    className="w-full rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <input
                    value={editDraft.location}
                    onChange={(e) => setEditDraft({ ...editDraft, location: e.target.value })}
                    className="w-full rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <select
                    value={editDraft.status}
                    onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value as SiteStatus })}
                    className="rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ON_HOLD">ON_HOLD</option>
                    <option value="COMPLETED">COMPLETED</option>
                  </select>
                </td>
                <td className="py-2">
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(s.id)} className="text-sm underline">
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
              <tr key={s.id} className="border-b border-border-soft">
                <td className="py-2">{s.name}</td>
                <td className="py-2">{s.client ?? "—"}</td>
                <td className="py-2">{s.location ?? "—"}</td>
                <td className="py-2">{s.status}</td>
                {canEdit && (
                  <td className="py-2">
                    <button onClick={() => startEdit(s)} className="text-sm underline">
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ),
          )}
          {sites.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-muted">
                No sites yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canEdit && (
        <form onSubmit={handleCreate} className="flex max-w-md flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-medium">Add site</h2>
          <input
            placeholder="Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            placeholder="Client (optional)"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            placeholder="Location (optional)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
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
