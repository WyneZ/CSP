# ADR-0003: Auth mechanism — session vs JWT

## Status
Accepted (2026-09-08)

## Context
v1 needs real auth (never-skip list) and 3-4 fixed roles. Two standard
mechanisms: server-side session (opaque cookie, server holds state) or JWT
(signed token, client holds state, server stays stateless).

## Options
1. **JWT.** Stateless — no server-side lookup per request, natural fit for
   multiple services or horizontal scaling. Downside: no instant revocation
   without a blacklist (defeats the stateless benefit); if stored in
   localStorage, readable by any injected script (XSS exposure).
2. **Session.** Server creates a session row on login, opaque ID in an
   `httpOnly` cookie. Downside: needs a session store; doesn't scale across
   servers without a shared store (Redis, or Postgres — not a concern at
   this scale).

## Decision
Session-based auth for v1.

## Reasoning
- CSP ERP is a single-deployment modular monolith, not multiple services —
  JWT's main advantage (statelessness across servers) doesn't apply here.
- Revocation matters more than usual: this is stock and money. Firing a
  storekeeper or resetting a compromised password needs to lock them out
  immediately — deleting a session row does that; a live JWT does not,
  short of a blacklist (which re-introduces the state JWT was meant to
  avoid).
- Session cookie can be `httpOnly` — not readable by JavaScript, so an XSS
  bug can't walk off with it the way it could a localStorage-held JWT.
- One person maintaining this for years: session's mental model (login
  creates a row, logout deletes it) is simpler to carry than access+refresh
  token rotation done correctly.

## Consequences
- Needs a session store. Postgres-backed (already the DB in use) rather
  than adding Redis this early — matches the "skip Redis for now" prototype
  scope.
- Revisit if: a separate mobile app is built later (JWT suits a client that
  isn't a browser better), or the deployment moves to multiple app servers
  without a shared session store.
