"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useRequireAuth, type Role } from "@/lib/session-context";

type Material = { id: string; code: string; name: string; unit: string; reorderLevel: string | null };
type CurrentStockRow = { siteId: string; materialId: string; quantity: string };

const moduleLinks: { href: string; label: string; roles: Role[] }[] = [
  { href: "/requisitions", label: "Requisitions", roles: ["ADMIN", "SITE_ENGINEER", "STOREKEEPER", "VIEWER"] },
  { href: "/sites", label: "Sites", roles: ["ADMIN", "SITE_ENGINEER", "STOREKEEPER", "VIEWER"] },
  { href: "/materials", label: "Materials", roles: ["ADMIN", "SITE_ENGINEER", "STOREKEEPER", "VIEWER"] },
  { href: "/vendors", label: "Vendors", roles: ["ADMIN", "SITE_ENGINEER", "VIEWER"] },
];

const roleLabels: Record<Role, string> = {
  ADMIN: "Admin",
  SITE_ENGINEER: "Site Engineer",
  STOREKEEPER: "Storekeeper",
  VIEWER: "Viewer",
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Home() {
  const { user, loading } = useRequireAuth();
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [materials, current] = await Promise.all([
          api.get<Material[]>("/materials"),
          api.get<CurrentStockRow[]>("/stock/current"),
        ]);
        const totals = new Map<string, number>();
        for (const row of current) {
          totals.set(row.materialId, (totals.get(row.materialId) ?? 0) + Number(row.quantity));
        }
        const low = materials.filter((m) => m.reorderLevel != null && (totals.get(m.id) ?? 0) < Number(m.reorderLevel));
        setLowStockCount(low.length);
      } catch {
        setLowStockCount(null);
      }
    })();
  }, [user]);

  if (loading || !user) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="hidden h-11 w-11 items-center justify-center rounded-full bg-accent-tint text-sm font-bold text-accent md:flex">
          {initials(user.name)}
        </div>
        <div>
          <h1 className="text-lg font-bold md:text-xl">
            {greeting()}, {user.name}
          </h1>
          <p className="text-sm text-muted">{roleLabels[user.role]}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/stock?tab=record&type=receipts"
          className="flex h-[132px] flex-col justify-between rounded-2xl border border-border bg-card p-4"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-success-bg text-success">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 4v14" />
              <path d="m6 12 6 6 6-6" />
              <path d="M5 21h14" />
            </svg>
          </span>
          <span className="text-sm font-semibold">Store In</span>
        </Link>
        <Link
          href="/stock?tab=record&type=issues"
          className="flex h-[132px] flex-col justify-between rounded-2xl border border-border bg-card p-4"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-warning-bg text-warning">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V6" />
              <path d="m6 12 6-6 6 6" />
              <path d="M5 3h14" />
            </svg>
          </span>
          <span className="text-sm font-semibold">Store Out</span>
        </Link>
        <Link
          href="/stock?tab=current"
          className="flex h-[132px] flex-col justify-between rounded-2xl border border-border bg-card p-4"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-chip text-muted-2">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3 9 4.5-9 4.5-9-4.5Z" />
              <path d="m3 12 9 4.5 9-4.5" />
              <path d="m3 16.5 9 4.5 9-4.5" />
            </svg>
          </span>
          <span className="text-sm font-semibold">Current Stock</span>
        </Link>
        <Link
          href="/stock?tab=history"
          className="flex h-[132px] flex-col justify-between rounded-2xl border border-border bg-card p-4"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-chip text-muted-2">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <span className="text-sm font-semibold">History</span>
        </Link>
      </div>

      {lowStockCount !== null && lowStockCount > 0 && (
        <Link
          href="/stock?tab=current"
          className="flex items-center gap-3 rounded-xl border bg-warning-bg px-4 py-3.5"
          style={{ borderColor: "#fed7aa" }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#c2410c" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M12 3.5 22 20H2Z" />
            <path d="M12 9.5v4.5" />
            <circle cx="12" cy="17" r="0.75" fill="#c2410c" stroke="none" />
          </svg>
          <span className="flex-1 text-sm" style={{ color: "#7c2d12" }}>
            {lowStockCount} material{lowStockCount === 1 ? "" : "s"} below reorder level
          </span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#c2410c" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </Link>
      )}

      <div className="flex flex-col gap-1 border-t border-border-soft pt-4">
        <span className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">More</span>
        {moduleLinks
          .filter((l) => l.roles.includes(user.role))
          .map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center justify-between rounded-lg px-2 py-3 text-sm font-medium hover:bg-chip"
            >
              {l.label}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-muted">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </Link>
          ))}
      </div>
    </div>
  );
}
