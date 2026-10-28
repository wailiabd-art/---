# AW V10 bridge integration candidate — verification report

## Scope
- Reference UI: `index(20261028-161105).html` (preserved unchanged).
- Candidate UI: `index(20261028-161105)-V10-BRIDGE-V2-CANDIDATE.html`.
- Bridge: `aw-v10-bridge-v2.js`.
- Backend source is included only as the existing foundation archive `AW_V10_OMEGA_BACKEND_MIGRATION_FOUNDATION.zip`; it has not been deployed or changed by this candidate.

## Confirmed checks
- PASS — original source file remains unchanged; SHA-256: `9b3e156e35f06ce04f8834d4ff2b435a5839500a1056b21479a5532f45b8d8a63`.
- PASS — candidate UI differs from the original by one external script reference only.
- PASS — `node --check` on bridge and backend `server.js`, `security.js`, `audit.js`.
- PASS — bridge smoke test: origin restriction, health checks, explicit login token held in memory, payload validation, exact 4-decimal base-currency balancing, explicit POST call, logout.
- PASS — backend foundation ZIP integrity (`unzip -t`).
- PASS — candidate bridge rejects off-origin API URLs; no automatic posting, data import, or migration is triggered by loading the page.

## Not verified / release blockers
- BLOCKED — no live server was available; API health, login, authorization, database schema, and document posting have not been tested against a deployed PostgreSQL instance.
- BLOCKED — no automatic outbox adapter was connected. The existing UI sync worker still targets its approved Supabase sync contract; it is not wire-compatible with the V10 document API as-is.
- BLOCKED — no schema/account mapping exists between local string-based journal accounts and V10 UUID `accountId` records. No local rows are posted to the backend.
- BLOCKED — no real local SQL.js database handle was passed into the migration preview; no row-count or balance reconciliation was performed on user data.
- BLOCKED — cross-device sync, offline replay, conflict handling, idempotency under concurrent requests, restore drills, browser/WebView and APK testing remain unverified.
- BLOCKED — this is a candidate build, not production-approved.

## Safety decisions
- Original UI file was not edited.
- Candidate bridge makes only explicit API calls; no automatic sync or migration runs on startup.
- Access token is held in memory only by the bridge; it is not written to localStorage/sessionStorage.
- API base is restricted to same-origin HTTPS (localhost HTTP allowed for local development), matching the current UI CSP and avoiding an unconfigured cross-origin/CORS path.
- No records were deleted or rewritten.

## Required next steps before production
1. Deploy the backend behind the same-origin HTTPS reverse proxy and verify `/health/live` and `/health/ready`.
2. Define and review a versioned account/company mapping and a source-to-target migration contract.
3. Export a read-only local database inventory and calculate per-currency totals plus trial-balance debit/credit totals.
4. Migrate to a staging database in a transaction with idempotency keys; compare row counts and totals before any cutover.
5. Implement a separately reviewed outbox adapter and conflict-resolution protocol compatible with the V10 API; do not point the existing Supabase worker at V10 endpoints.
6. Run browser/WebView E2E, multi-device, retry/concurrency, backup/restore, and failure-injection tests.
