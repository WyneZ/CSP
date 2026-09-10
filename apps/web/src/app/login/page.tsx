"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session-context";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const { refresh } = useSession();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/auth/login", { email, password });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#ffffff" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 3 8 4-8 4-8-4Z" />
            <path d="m4 11 8 4 8-4" />
            <path d="m4 15.5 8 4 8-4" />
          </svg>
        </div>
        <h1 className="text-xl font-bold tracking-tight">CSP ERP</h1>
        <p className="mb-8 mt-1 text-sm text-muted">Site Stock &amp; Requisitions</p>

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3.5">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-[52px] rounded-[10px] border-[1.5px] border-border bg-card px-3.5 text-[15px] text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-2">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-[52px] rounded-[10px] border-[1.5px] border-border bg-card px-3.5 text-[15px] text-foreground outline-none focus:border-accent"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-1.5 h-14 rounded-[10px] bg-accent text-[16px] font-semibold text-accent-foreground transition-opacity disabled:opacity-50"
          >
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
