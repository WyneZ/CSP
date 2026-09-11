// Phase A: the new integration specs (stock.service.spec.ts,
// requisitions.service.spec.ts) talk to Postgres directly through the
// @csp-erp/db singleton, bypassing Nest's normal bootstrap — so nothing
// else loads DATABASE_URL into process.env for a plain `jest` run. This
// file does that, run once before the test files via jest.config.ts's
// `setupFiles`.
//
// Prefers .env.test over .env so these tests never run against your dev
// database by accident: create apps/api/.env.test with its own
// DATABASE_URL (e.g. postgresql://postgres:postgres@localhost:5434/csp_erp_test)
// before running `pnpm --filter api test`. Falls back to .env if
// .env.test doesn't exist yet, so this doesn't block you on day one — but
// that means a first run without .env.test writes real ledger rows into
// your dev database (harmless — they're a distinct test tenant, cleaned
// up by each spec's afterEach — but still not ideal; add .env.test when
// you have a minute).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// process.cwd(), not __dirname: this file now runs as a real ES module
// under Jest's ESM transform (see jest.config.ts), and __dirname doesn't
// exist in that scope (Node ESM has no CJS-style file-relative globals —
// the usual replacement is import.meta.url, but that would make this file
// fail plain `tsc` under the base tsconfig's CommonJS-per-file inference,
// since apps/api's package.json isn't "type": "module"). Jest is always
// invoked from the apps/api package root (rootDir: '.' below assumes the
// same), so cwd is a safe, ESM/CJS-agnostic anchor here.
const testEnvPath = resolve(process.cwd(), '.env.test');
const envPath = resolve(process.cwd(), '.env');

if (existsSync(testEnvPath)) {
  process.loadEnvFile(testEnvPath);
} else if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
