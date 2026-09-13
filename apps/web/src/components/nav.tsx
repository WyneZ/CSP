"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/session-context";

const moduleLinks = [
  { href: "/sites", label: "Sites", roles: ["ADMIN", "SITE_ENGINEER", "STOREKEEPER", "VIEWER"] },
  { href: "/materials", label: "Materials", roles: ["ADMIN", "SITE_ENGINEER", "STOREKEEPER", "VIEWER"] },
  { href: "/vendors", label: "Vendors", roles: ["ADMIN", "SITE_ENGINEER", "VIEWER"] },
  { href: "/requisitions", label: "Requisitions", roles: ["ADMIN", "SITE_ENGINEER", "STOREKEEPER", "VIEWER"] },
];

const topLinks = [
  { href: "/stock", label: "Stock", roles: ["ADMIN", "SITE_ENGINEER", "STOREKEEPER", "VIEWER"] },
  ...moduleLinks,
];

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={active ? 1.85 : 1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

function StockIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={active ? 1.85 : 1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3 9 4.5-9 4.5-9-4.5Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </svg>
  );
}

// New Requisition -- a document with a plus, distinct from the generic
// "Requisitions" module link icon (there wasn't one before; this is the
// only genuinely new icon Phase 2 needed, since the spec requires a
// direct bottom-nav entry point into Screen 1).
function NewRequisitionIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={active ? 1.85 : 1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5Z" />
      <path d="M14 3.5V7a1 1 0 0 0 1 1h3.5" />
      <path d="M12 12v5M9.5 14.5h5" />
    </svg>
  );
}

// Requests (My Requisitions) -- a simple checklist, reused as the Site
// Engineer's dedicated entry into Screen 3.
function RequestsIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={active ? 1.85 : 1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  );
}

export function Nav() {
  const { user, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!user) return null;

  const isHome = pathname === "/";
  const isStock = pathname.startsWith("/stock");
  // Site Engineer gets two extra role-specific bottom-tab destinations
  // (Phase 2 spec: Screen 1 and Screen 3 are both entered "via the
  // existing role-specific bottom nav"). Every other role's nav is
  // untouched -- this is additive, not a redesign of the shared bar.
  const isSiteEngineer = user.role === "SITE_ENGINEER";
  const isNewRequisition = pathname === "/requisitions/new";
  const isRequests = pathname === "/requisitions" && isSiteEngineer;
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleLogout() {
    setMoreOpen(false);
    await logout();
    router.replace("/login");
  }

  return (
    <>
      {/* Desktop top bar */}
      <nav className="hidden border-b border-border bg-card md:block">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight">CSP ERP</span>
            <div className="flex gap-4 text-sm">
              <Link href="/" className={isHome ? "font-medium text-foreground" : "text-muted hover:text-foreground"}>
                Home
              </Link>
              {topLinks
                .filter((l) => l.roles.includes(user.role))
                .map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={pathname.startsWith(l.href) ? "font-medium text-foreground" : "text-muted hover:text-foreground"}
                  >
                    {l.label}
                  </Link>
                ))}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span>
              {user.name} &middot; {user.role}
            </span>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-chip"
            >
              Log out
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile top bar (compact, just brand + avatar) */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
        <span className="text-sm font-semibold tracking-tight">CSP ERP</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-tint text-xs font-bold text-accent">
          {initials}
        </div>
      </div>

      {/* Mobile "More" sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-16 left-0 right-0 rounded-t-2xl border-t border-border bg-card p-2 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {moduleLinks
              .filter((l) => l.roles.includes(user.role))
              .map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMoreOpen(false)}
                  className="block rounded-lg px-4 py-3 text-sm font-medium text-foreground hover:bg-chip"
                >
                  {l.label}
                </Link>
              ))}
            <div className="my-1 border-t border-border-soft" />
            <div className="px-4 py-2 text-xs text-muted">
              {user.name} &middot; {user.role}
            </div>
            <button
              onClick={handleLogout}
              className="block w-full rounded-lg px-4 py-3 text-left text-sm font-medium text-danger hover:bg-chip"
            >
              Log out
            </button>
          </div>
        </div>
      )}

      {/* Mobile bottom tab bar -- Site Engineer sees two extra destinations
          (New Requisition, Requests) alongside the same Home/Stock/More
          every role already has; no role loses a destination. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex h-16">
          <Link href="/" className="flex h-full flex-1 flex-col items-center justify-center gap-1" style={{ color: isHome ? "var(--accent)" : "var(--muted-2)" }}>
            <HomeIcon active={isHome} />
            <span className={`text-[11px] ${isHome ? "font-semibold" : "font-medium"}`}>Home</span>
          </Link>
          <Link href="/stock" className="flex h-full flex-1 flex-col items-center justify-center gap-1" style={{ color: isStock ? "var(--accent)" : "var(--muted-2)" }}>
            <StockIcon active={isStock} />
            <span className={`text-[11px] ${isStock ? "font-semibold" : "font-medium"}`}>Stock</span>
          </Link>
          {isSiteEngineer && (
            <>
              <Link
                href="/requisitions/new"
                className="flex h-full flex-1 flex-col items-center justify-center gap-1"
                style={{ color: isNewRequisition ? "var(--accent)" : "var(--muted-2)" }}
              >
                <NewRequisitionIcon active={isNewRequisition} />
                <span className={`text-[11px] ${isNewRequisition ? "font-semibold" : "font-medium"}`}>New Request</span>
              </Link>
              <Link
                href="/requisitions"
                className="flex h-full flex-1 flex-col items-center justify-center gap-1"
                style={{ color: isRequests ? "var(--accent)" : "var(--muted-2)" }}
              >
                <RequestsIcon active={isRequests} />
                <span className={`text-[11px] ${isRequests ? "font-semibold" : "font-medium"}`}>Requests</span>
              </Link>
            </>
          )}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="flex h-full flex-1 flex-col items-center justify-center gap-1"
            style={{ color: "var(--muted-2)" }}
          >
            <MoreIcon />
            <span className="text-[11px] font-medium">More</span>
          </button>
        </div>
      </div>
    </>
  );
}
