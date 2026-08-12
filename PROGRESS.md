# Little Scholars Portal — 3-Day Launch Progress

Last updated: 2026-08-12 (day 1)

## Done and merged into `launch-prep`

- **Student portal backend** — real `/api/student/*` routes (dashboard, courses, results), filtered strictly to the logged-in student's own ID, showing only *published* results. Two demo students verified to see different, correct data. Sections with no backing data model (timetable, assignments, announcements) are honestly labeled "Sample · feature coming soon" rather than faked.
- **Staff Results Entry redesign** — the old UI hid a proper spreadsheet-style grid behind a "Bulk Entry" toggle, defaulting to slow one-student-at-a-time cards. Grid is now the default view, sticky header, styling matches the rest of the app. No functional/API changes.
- **Security hardening** — all passwords hashed (`node:crypto` scrypt, salted, timing-safe compare), existing plaintext passwords auto-migrated on boot, login rate limiting (5 failed attempts / 15 min lockout), and the System Settings tab's `_sid` ReferenceError bug is fixed.

All three verified together via a clean local boot + curl smoke test (all 3 demo logins work, rate limiting triggers, System Settings loads) before merging. No conflicts.

## Known bug found (blocks the item below — fix as part of it)

**PDF report generation is broken.** The report-publish flow depends on `pdf-lib`, which isn't actually vendored in this repo — there's only a hardcoded file path pointing to a different developer's local machine. This means `/api/admin/reports/publish` currently fails for anyone. This must be fixed (vendor `pdf-lib` properly, or replace with a self-contained PDF generation approach — check zero-npm-dependency constraint; if `pdf-lib` requires npm, either add it as the one justified exception or hand-roll minimal PDF generation) before "Results Publish + email" can work end to end.

## Next up (not started)

1. **Results Publish + parent email** — On the admin "Review And Publish Results" screen, add a "Publish" button beside "View Results" that publishes results and emails each parent their child's report. Reuse the existing `smtpSend` raw-socket SMTP pipeline in `server.js`. Must fix the `pdf-lib` bug above first. No real SMTP credentials exist in the cloud sandbox (`email-settings.env` is gitignored) — implement and trace the code path correctly, but live email delivery needs verification after merge with real credentials.
2. **Finance MVP** — Fees/Bursary, Payroll/HRM, Store & Inventory, Accounting are all UI shells with zero backend. Build working basics (real CRUD, correct core numbers) across all of them — breadth over depth, nothing left as a dead button. Split into separate `feature/finance-*` branches by sub-area so partial progress isn't lost.
   - **Store & Inventory / Accounting: done, on `feature/finance-store-accounting` (not yet merged).** New tables (`store_categories/products/orders/order_items/stock_movements/requisitions/banners/homepage_sections`, `acct_accounts/journal_entries/journal_lines/contacts/bills/budgets/bank_transactions/tax_records`), seeded with realistic demo data, full CRUD routes under `/api/admin/store/*` and `/api/admin/acct/*`, and all 19 sidebar screens (10 Store & Inventory + 9 Accounting) wired to real data — no dead buttons, no hardcoded numbers. POS terminal records a real sale and decrements stock; journal entries are validated balanced before posting; trial balance and financial reports are computed live from posted journal lines. Bank reconciliation and tax records are intentionally thin (manual entry + reconcile/status toggle, no automated matching or tax logic) per the MVP-first instruction. Verified via curl: all 3 demo logins, fresh-DB boot + seed, full CRUD round-trips, POS stock decrement, unbalanced-entry rejection, in-use-account delete protection. Fees/Bursary and Payroll/Expenses are separate sibling branches, not touched here.

## Branch model (do not deviate)

- `master` = live production (Railway auto-deploys from it). Never push here directly.
- `launch-prep` = integration branch, this is where everything lands for human review.
- `feature/*` branches, based off latest `launch-prep`, merged back in after a sanity check (server boots, demo logins work, no regression).

## Demo logins (auto-seeded on fresh DB)

Admin `ADM-001`/`admin123` · Staff `TCH-001`/`teach123` · Student `STU-2024-0421`/`amara123`
