"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/session-context";
import { requisitionRef } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";

type Site = { id: string; name: string };
type Material = { id: string; code: string; name: string; unit: string };
type DraftLine = { materialId: string; requestedQty: string };
// Note: requestedBy is NOT included here on purpose -- create()/submit()
// on the backend don't select that relation (only the GET /requisitions
// list used by checkStatus() does), so it can't be relied on after a
// normal submit. The success screen uses the logged-in user's own name
// instead (this screen only ever shows a requisition the current user
// just created).
type CreatedRequisition = {
  id: string;
  status: string;
  createdAt: string;
};

type View = "form" | "submitting" | "success" | "timeout" | "failure";

const DRAFT_STORAGE_KEY = "csp-erp:new-requisition:draft";
// "Taking longer than expected" threshold (Phase 2 spec §7). Not an
// abort -- the underlying request keeps running; this only changes what
// the screen shows while waiting.
const SUBMIT_TIMEOUT_MS = 8000;

type StoredDraft = { idempotencyKey: string; siteId: string; lines: DraftLine[]; purpose: string };

function loadDraft(): StoredDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: StoredDraft) {
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage can throw (private mode, quota) -- the in-memory
    // idempotency key ref still protects retry-safety within this same
    // page load even if refresh-recovery isn't available.
  }
}

function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

export default function NewRequisitionPage() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();

  const [sites, setSites] = useState<Site[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // Site is meant to be implicit/system-controlled (Phase 2 spec §6) --
  // but the current User model has no site assignment at all (no
  // per-user siteId anywhere in the schema). The honest thing this UI can
  // do without inventing backend state: auto-select silently when there
  // is genuinely only one site (the real v1 case), and fall back to a
  // visible required picker only if more than one exists. See the
  // "Backend/domain mismatch" note in the implementation report.
  const [siteId, setSiteId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ materialId: "", requestedQty: "" }]);
  const [purpose, setPurpose] = useState("");
  const [touchedSubmit, setTouchedSubmit] = useState(false);

  const [view, setView] = useState<View>("form");
  const [created, setCreated] = useState<CreatedRequisition | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a stale response from an abandoned attempt clobbering
  // state for a newer one (e.g. user hit Retry, which starts a fresh call
  // sharing the same key -- only the most recent call's resolution should
  // update the screen).
  const attemptSeqRef = useRef(0);

  useEffect(() => {
    async function loadLookups() {
      try {
        const [s, m] = await Promise.all([api.get<Site[]>("/sites"), api.get<Material[]>("/materials")]);
        setSites(s);
        setMaterials(m);
        // The only honest way to make "site is implicit" true today.
        if (s.length === 1) setSiteId(s[0].id);
      } finally {
        setLoadingLookups(false);
      }
    }
    if (user) loadLookups();
  }, [user]);

  // Refresh-safe recovery (Phase 2 spec's idempotency UX section): if a
  // draft was mid-flight when the page was reloaded, restore it and its
  // key so a retry from here still replays instead of duplicating.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      idempotencyKeyRef.current = draft.idempotencyKey;
      setSiteId((current) => current || draft.siteId);
      setLines(draft.lines);
      setPurpose(draft.purpose);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function addLine() {
    setLines((prev) => [...prev, { materialId: "", requestedQty: "" }]);
  }

  const usedMaterialIds = (excludeIndex: number) =>
    new Set(lines.filter((_, idx) => idx !== excludeIndex).map((l) => l.materialId).filter(Boolean));

  const lineErrors = lines.map((line, i) => {
    const others = usedMaterialIds(i);
    const duplicate = line.materialId && others.has(line.materialId);
    const qty = Number(line.requestedQty);
    const qtyInvalid = line.requestedQty !== "" && (!Number.isFinite(qty) || qty <= 0);
    return { duplicate, qtyInvalid };
  });

  const purposeInvalid = touchedSubmit && purpose.trim().length === 0;
  const linesValid =
    lines.length > 0 &&
    lines.every((l) => l.materialId && Number(l.requestedQty) > 0) &&
    !lineErrors.some((e) => e.duplicate);
  const canSubmit = !!siteId && linesValid && purpose.trim().length > 0;

  function materialById(id: string) {
    return materials.find((m) => m.id === id);
  }

  async function attemptSubmit() {
    setTouchedSubmit(true);
    if (!canSubmit) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    const key = idempotencyKeyRef.current;
    const payload = {
      siteId,
      remarks: purpose.trim(),
      idempotencyKey: key,
      lines: lines.map((l) => ({ materialId: l.materialId, requestedQty: Number(l.requestedQty) })),
    };
    saveDraft({ idempotencyKey: key, siteId, lines, purpose });

    const mySeq = ++attemptSeqRef.current;
    setGeneralError(null);
    setView("submitting");

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (attemptSeqRef.current === mySeq) setView("timeout");
    }, SUBMIT_TIMEOUT_MS);

    try {
      // create() immediately calls submit() server-side too (one-step
      // submit, no Draft ever shown to the user) -- see requisitions
      // .service.ts's create()/submit(); this UI never renders DRAFT.
      const requisition = await api.post<CreatedRequisition>("/requisitions", payload);
      const submitted = await api.post<CreatedRequisition>(`/requisitions/${requisition.id}/submit`).catch((err) => {
        // Already PENDING_APPROVAL (e.g. a replayed create on a request
        // that already got submitted) surfaces as a Conflict -- that is
        // not a failure, it's confirmation the requisition already
        // reached the state we wanted. Anything else is a real error.
        if (err instanceof ApiError && err.status === 409) return requisition;
        throw err;
      });
      if (attemptSeqRef.current !== mySeq) return; // superseded by a newer attempt
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      clearDraft();
      idempotencyKeyRef.current = null;
      setCreated(submitted);
      setView("success");
    } catch (err) {
      if (attemptSeqRef.current !== mySeq) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // Key is deliberately kept (not cleared) on failure -- a Retry of
      // this same attempt must reuse it, or a request that actually
      // succeeded server-side but whose response was lost would get
      // double-posted.
      setGeneralError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
      setView("failure");
    }
  }

  // "Check status" (Screen 2 timeout state): the create call carries an
  // idempotency key, but there is no lookup-by-key endpoint -- so, per
  // the approved spec's own fallback wording, this looks at the user's
  // own recent requisitions and asks "does one of these match what I just
  // typed" rather than pretending to have a definitive answer the
  // backend can't actually give it.
  async function checkStatus() {
    setGeneralError(null);
    try {
      const all = await api.get<
        {
          id: string;
          status: string;
          createdAt: string;
          remarks: string | null;
          siteId: string;
          requestedBy: { id: string; name: string };
          lines: { materialId: string; requestedQty: string }[];
        }[]
      >("/requisitions");
      const mine = all
        .filter((r) => r.requestedBy.id === user!.id)
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      const match = mine.find((r) => {
        if (r.siteId !== siteId) return false;
        if ((r.remarks ?? "") !== purpose.trim()) return false;
        if (r.lines.length !== lines.length) return false;
        const sortedA = [...r.lines].sort((a, b) => a.materialId.localeCompare(b.materialId));
        const sortedB = [...lines].sort((a, b) => a.materialId.localeCompare(b.materialId));
        return sortedA.every((l, i) => l.materialId === sortedB[i].materialId && Number(l.requestedQty) === Number(sortedB[i].requestedQty));
      });
      if (match) {
        clearDraft();
        idempotencyKeyRef.current = null;
        setCreated(match);
        setView("success");
      } else {
        setView("failure");
        setGeneralError("Couldn't find this request. Check your connection and try again — your request details are still filled in.");
      }
    } catch {
      // Checking itself failed (still offline, etc.) -- stay in the
      // timeout state rather than jumping to a false "confirmed failure."
      setGeneralError("Still checking — couldn't reach the server just now.");
    }
  }

  function editRequest() {
    setView("form");
  }

  if (loading || !user || loadingLookups) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  // ---- Result screens (Screen 2) --------------------------------------

  if (view === "success" && created) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-success">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <h1 className="text-lg font-bold">Request submitted.</h1>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold">{requisitionRef(created.id)}</span>
            <StatusBadge status={created.status} />
          </div>
          <p className="text-xs text-muted">
            Submitted {new Date(created.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} &middot;{" "}
            {user.name}
          </p>
        </div>

        <p className="text-sm text-muted-2">
          Your request is now waiting for approval. You&apos;ll see the decision here or in My Requisitions.
        </p>

        <div className="mt-2 flex flex-col gap-2">
          <button
            onClick={() => router.push(`/requisitions/${created.id}`)}
            className="flex h-14 items-center justify-center rounded-[10px] bg-accent text-[16px] font-semibold text-accent-foreground"
          >
            View request
          </button>
          <button
            onClick={() => router.push("/requisitions")}
            className="flex h-14 items-center justify-center rounded-[10px] border border-border text-[16px] font-semibold text-foreground"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  if (view === "timeout") {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-bg text-warning">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
          </span>
          <h1 className="text-lg font-bold">This is taking longer than expected.</h1>
          <p className="text-sm text-muted-2">Your request may still be processing.</p>
        </div>
        {generalError && <p className="text-center text-sm text-muted">{generalError}</p>}
        <button
          onClick={checkStatus}
          className="flex h-14 items-center justify-center rounded-[10px] bg-accent text-[16px] font-semibold text-accent-foreground"
        >
          Check status
        </button>
      </div>
    );
  }

  if (view === "failure") {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v5" />
              <path d="M12 16.5v.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </span>
          <h1 className="text-lg font-bold">Couldn&apos;t submit this request.</h1>
          <p className="text-sm text-muted-2">
            {generalError ?? "Check your connection and try again."} Nothing has been sent yet — your request details are still filled in.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={attemptSubmit}
            className="flex h-14 items-center justify-center rounded-[10px] bg-accent text-[16px] font-semibold text-accent-foreground"
          >
            Retry
          </button>
          <button
            onClick={editRequest}
            className="flex h-14 items-center justify-center rounded-[10px] border border-border text-[16px] font-semibold text-foreground"
          >
            Edit request
          </button>
        </div>
      </div>
    );
  }

  // ---- Form (Screen 1) --------------------------------------------------

  const submitting = view === "submitting";
  const showMultiSite = sites.length > 1;

  return (
    <div className="flex flex-col gap-5 pb-16 md:mx-auto md:max-w-2xl md:pb-6">
      <h1 className="text-xl font-bold">New Requisition</h1>

      {/* Backend/domain gap, not silently papered over: there is no
          per-user site assignment yet, so "implicit site" can only be
          true when exactly one site exists. */}
      {showMultiSite && (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
          Site
          <select
            required
            disabled={submitting}
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="h-[50px] rounded-[10px] border-[1.5px] border-border bg-card px-3.5 text-[16px] disabled:opacity-60"
          >
            <option value="">Select site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-3">
        {lines.map((line, i) => {
          const others = usedMaterialIds(i);
          const err = lineErrors[i];
          const material = materialById(line.materialId);
          return (
            <div key={i} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-muted-2">
                  Material
                  <select
                    required
                    disabled={submitting}
                    value={line.materialId}
                    onChange={(e) => updateLine(i, { materialId: e.target.value })}
                    className="h-[50px] rounded-[10px] border-[1.5px] border-border bg-card px-3.5 text-[16px] disabled:opacity-60"
                  >
                    <option value="">Select material…</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id} disabled={others.has(m.id)}>
                        {m.code} — {m.name} ({m.unit})
                        {others.has(m.id) ? " · already on this request" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {lines.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove this material line"
                    disabled={submitting}
                    onClick={() => removeLine(i)}
                    className="mt-6 flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-border text-muted-2 disabled:opacity-60"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                )}
              </div>
              {err.duplicate && (
                <p className="text-xs text-danger">
                  {material?.name ?? "This material"} is already on this request — edit the quantity above instead of adding it twice.
                </p>
              )}
              <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
                Requested quantity
                <div
                  className="flex h-14 items-center gap-2 rounded-[10px] border-[1.5px] bg-card px-3.5 focus-within:ring-2 focus-within:ring-accent/30"
                  style={{ borderColor: err.qtyInvalid ? "var(--danger)" : "var(--border)" }}
                >
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    disabled={submitting}
                    placeholder="0"
                    value={line.requestedQty}
                    onChange={(e) => updateLine(i, { requestedQty: e.target.value })}
                    className="w-full bg-transparent font-mono text-lg font-bold outline-none disabled:opacity-60"
                  />
                  {material && (
                    <span className="rounded-md bg-chip px-2 py-1 text-xs font-semibold text-muted-2">{material.unit}</span>
                  )}
                </div>
              </label>
              {err.qtyInvalid && <p className="text-xs text-danger">Enter a quantity greater than 0.</p>}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={submitting}
        onClick={addLine}
        className="self-start text-sm font-semibold text-accent disabled:opacity-60"
      >
        + Add another material
      </button>

      {/* The Phase 2 spec (SS6) lists a required "Needed-by date" field
          here -- the backend has no `neededBy` column on Requisition
          (only `remarks`), so this field is intentionally not rendered
          rather than faked with client-only state that nothing would
          ever read back. Same documented gap as the Detail page's
          equivalent note. */}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
        Purpose
        <textarea
          disabled={submitting}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          rows={2}
          placeholder="What is this material for?"
          className="rounded-[10px] border-[1.5px] bg-card px-3.5 py-3 text-[16px] outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
          style={{ borderColor: purposeInvalid ? "var(--danger)" : "var(--border)" }}
        />
      </label>
      {purposeInvalid && <p className="-mt-3 text-xs text-danger">Add a purpose so the approver knows what this is for.</p>}

      {generalError && view === "form" && <p className="text-sm text-danger">{generalError}</p>}

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card p-4 md:static md:border-0 md:bg-transparent md:p-0">
        <button
          onClick={attemptSubmit}
          disabled={submitting || (touchedSubmit && !canSubmit)}
          className="flex h-14 w-full items-center justify-center rounded-[10px] bg-accent text-[16px] font-semibold text-accent-foreground disabled:opacity-40 md:w-auto md:self-start md:px-6"
        >
          {submitting ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </div>
  );
}
