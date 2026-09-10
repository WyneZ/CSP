"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";

type Vendor = {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

type EditDraft = { name: string; contactName: string; contactPhone: string };

export default function VendorsPage() {
  const { user, loading } = useRequireAuth();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const canEdit = user?.role === "ADMIN" || user?.role === "SITE_ENGINEER";

  async function load() {
    setVendors(await api.get<Vendor[]>("/vendors"));
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/vendors", {
        name,
        contactName: contactName || undefined,
        contactPhone: contactPhone || undefined,
      });
      setName("");
      setContactName("");
      setContactPhone("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  function startEdit(v: Vendor) {
    setEditingId(v.id);
    setEditDraft({ name: v.name, contactName: v.contactName ?? "", contactPhone: v.contactPhone ?? "" });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    setError(null);
    try {
      await api.patch(`/vendors/${id}`, {
        name: editDraft.name,
        contactName: editDraft.contactName || undefined,
        contactPhone: editDraft.contactPhone || undefined,
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
      <h1 className="text-xl font-bold">Vendors</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">Name</th>
            <th className="py-2">Contact</th>
            <th className="py-2">Phone</th>
            {canEdit && <th className="py-2"></th>}
          </tr>
        </thead>
        <tbody>
          {vendors.map((v) =>
            editingId === v.id && editDraft ? (
              <tr key={v.id} className="border-b border-border-soft">
                <td className="py-2">
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    className="w-full rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <input
                    value={editDraft.contactName}
                    onChange={(e) => setEditDraft({ ...editDraft, contactName: e.target.value })}
                    className="w-full rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <input
                    value={editDraft.contactPhone}
                    onChange={(e) => setEditDraft({ ...editDraft, contactPhone: e.target.value })}
                    className="w-full rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-accent"
                  />
                </td>
                <td className="py-2">
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(v.id)} className="text-sm underline">
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
              <tr key={v.id} className="border-b border-border-soft">
                <td className="py-2">{v.name}</td>
                <td className="py-2">{v.contactName ?? "—"}</td>
                <td className="py-2">{v.contactPhone ?? "—"}</td>
                {canEdit && (
                  <td className="py-2">
                    <button onClick={() => startEdit(v)} className="text-sm underline">
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ),
          )}
          {vendors.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-muted">
                No vendors yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canEdit && (
        <form onSubmit={handleCreate} className="flex max-w-md flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-medium">Add vendor</h2>
          <input
            placeholder="Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            placeholder="Contact name (optional)"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            placeholder="Phone (optional)"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
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
