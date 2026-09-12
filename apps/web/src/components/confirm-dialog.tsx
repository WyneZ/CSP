"use client";

import { useState } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  // When set, renders a required text field (e.g. a rejection reason) and
  // passes its trimmed value to onConfirm.
  requireText?: { label: string; placeholder?: string };
  onConfirm: (text?: string) => void | Promise<void>;
  onCancel: () => void;
};

// Reuses the exact bottom-sheet overlay pattern already established in
// components/nav.tsx's mobile "More" sheet (a fixed dark overlay + a
// rounded-t-2xl card sliding up from the bottom) instead of inventing a
// new centered-modal component -- this was the only overlay pattern that
// existed in the codebase before Phase 2. On wider (tablet/desktop)
// viewports it centers instead of anchoring to the bottom, matching the
// existing breakpoint contract rather than a phone-only sheet stretched
// across a desktop screen.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  requireText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const disabled = busy || (!!requireText && text.trim().length === 0);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm(requireText ? text.trim() : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="absolute inset-0 bg-black/30" onClick={busy ? undefined : onCancel} />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 rounded-t-2xl border-t border-border bg-card p-5 shadow-lg sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
        <h2 id="confirm-dialog-title" className="text-base font-bold">
          {title}
        </h2>
        <p className="text-sm text-muted-2">{message}</p>
        {requireText && (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
            {requireText.label}
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={requireText.placeholder}
              rows={2}
              className="rounded-[10px] border-[1.5px] border-border bg-card px-3.5 py-3 text-[16px] outline-none focus:border-accent"
            />
          </label>
        )}
        <div className="mt-1 flex flex-col gap-2">
          <button
            onClick={handleConfirm}
            disabled={disabled}
            className="flex h-12 items-center justify-center rounded-[10px] text-[15px] font-semibold text-white disabled:opacity-40"
            style={{ background: destructive ? "var(--danger)" : "var(--accent)" }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex h-12 items-center justify-center rounded-[10px] border border-border text-[15px] font-semibold text-foreground disabled:opacity-40"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
