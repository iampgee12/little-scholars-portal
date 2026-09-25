# Little Scholars Portal — 3-Day Launch Progress

Last updated: 2026-08-12 (day 1)

## Done and merged into `launch-prep`

Everything originally scoped is now built, merged together, and verified working as a whole (not just individually) on a fresh database:

- **Student portal backend** — real `/api/student/*` routes, filtered strictly to the logged-in student's own ID, showing only *published* results. Unbuilt areas (timetable, assignments, announcements) are honestly labeled "coming soon" rather than faked.
- **Staff Results Entry redesign** — standard spreadsheet-style grid is now the default view instead of one-student-at-a-time cards. No functional/API changes.
- **Security hardening** — passwords hashed (scrypt, salted), plaintext auto-migrated on boot, login rate limiting (5 attempts / 15 min lockout), System Settings crash fixed.
- **Results Publish + parent email** — "Publish" button on the admin "Review And Publish Results" screen. Fixed the pre-existing broken PDF generation (`pdf-lib` is now a real, properly vendored dependency — was previously a hardcoded path to another developer's machine that could never have worked). Also found and fixed a second latent bug: an inner JOIN that silently failed publishing for any student without a portal login account (would have broken most real classes, not just the demo one). Emails parents via the existing SMTP pipeline when configured; publishes + generates the PDF regardless and says so clearly when SMTP isn't set up.
- **Finance MVP** (breadth-first, real CRUD, no dead buttons, no fake numbers):
  - **Fees & Bursary** — invoices, payments, family fee history, debtors report.
  - **Payroll & Expenses** — staff salaries, loans/advances, expense request approval workflow, income/expense logging + analytics.
  - **Store & Accounting** — inventory/POS with real stock decrement on sale, and a minimal general ledger (chart of accounts, journal entries validated balanced before posting, live trial balance, financial reports). Bank reconciliation and tax records are intentionally thin (manual entry, no automated logic) per the MVP-first instruction.

All four finance/results branches were built by independent cloud routines (RemoteTrigger, genuinely detached from any local session), each verified individually via curl before merging, then merged into `launch-prep` one at a time. Two merges hit real conflicts — in both cases, git had collapsed two independently-added code blocks' generic closing braces into one shared line (a known git 3-way-merge artifact when two additions end in textually-identical trailing lines). Resolved by pulling each side's clean content directly from its source branch and splicing manually, then verifying with `node --check` and a full curl pass covering all four merged areas together (all 3 demo logins, rate limiting, and one representative route from each feature) on a completely fresh database.

## Branch model (do not deviate)

- `master` = live production (Railway auto-deploys from it). Never push here directly.
- `launch-prep` = integration branch — everything above is merged and verified here, ready for human review. **Not yet merged to master/production.**
- `feature/*` branches, based off latest `launch-prep`, merged back in after a sanity check.

## What's left

- **Human review of `launch-prep`** before it goes anywhere near `master`/production — nothing has been deployed live.
- Everything else originally requested (finance, results publish, staff/student portals) is done. CBT was explicitly deferred by the owner to a later phase.

## SMTP — verified working (2026-08-12)

Real end-to-end test performed locally against the real Gmail SMTP config in `email-settings.env` (already present, gitignored, never committed): vetted and published Class 4B's Mid-Term Exam batch with two students' parent emails temporarily pointed at real inboxes for the test. Both came back `emailStatus: "sent"` from the actual publish endpoint — not a mock. Awaiting the owner's confirmation that the PDF actually landed in both inboxes (Gmail accepting the send doesn't guarantee delivery/formatting is right). No code changes were needed either way.

## Demo logins (auto-seeded on fresh DB)

Admin `ADM-001`/`admin123` · Staff `TCH-001`/`teach123` · Student `STU-2024-0421`/`amara123`

## Check-in (2026-08-14)

No new `feature/*` work landed since the 2026-08-12 merge. All seven feature branches on origin (student-portal-backend, staff-results-entry-redesign, security-hardening, results-publish-email, finance-fees-bursary, finance-payroll-expenses, finance-store-accounting) confirmed already merged into `launch-prep` via `git merge-base --is-ancestor`. Local `launch-prep` was already up to date with `origin/launch-prep` — nothing to push. Re-ran sanity checks against the already-running local server: `node --check` clean on `server.js`/`admin-api.js`/`teacher-api.js`, all three demo logins still return 200, and a real `/api/admin/fees/invoices` call returned live data. Status unchanged: everything originally scoped is built and merged; the only remaining step is the owner's review of `launch-prep` before it goes anywhere near `master`. Not invoking new scope per instructions — nothing in "What's left" beyond that review.

## Check-in (2026-09-25) — `feature/finance-payroll-expenses`

Routine fired against `feature/finance-payroll-expenses` specifically. That branch's tip was confirmed (`git merge-base --is-ancestor`) to already be fully absorbed into `launch-prep` — no unique commits of its own beyond the render.yaml config added after the original merge. It had gone stale relative to `launch-prep` (missing CBT, security hardening, results-publish, and the other two finance areas merged since). Fast-forwarded the branch to `origin/launch-prep` and pushed, so it now reflects the current integrated state instead of a month-old snapshot.

Fresh sanity check on a clean DB against that updated branch: server boots cleanly, all three demo logins work, and the full Payroll & Expenses surface was exercised live via curl — payroll rates, salary run generation (`/api/admin/payroll/salaries/generate`), marking a salary paid, staff loan creation and status advancement, expense request submission → approve → dispense (which correctly auto-creates the linked expense record), income logging, and the analytics summary endpoint. All returned correct data with no server errors. Cross-checked every DOM element ID and onclick handler referenced by the Payroll/Expenses admin-portal.html JS against the actual markup (including handlers built dynamically in table-row template strings) — no stale references. No code changes were needed; this area was already complete.

## Check-in (2026-09-25, later firing) — `feature/finance-payroll-expenses`

Third consecutive firing against this branch; still nothing new to do. Re-ran an independent fresh-DB sanity pass: server boots clean, all three demo logins verified (200), and exercised the full Payroll & Expenses workflow live — pay rates, salary run generation with real entries, marking a salary paid, loan creation, expense request submission + approve, income logging, and `/api/admin/finance/analytics`. All correct, zero server-side errors in the log. Confirmed the admin-api.js frontend calls match the live server.js route paths exactly (e.g. analytics is `/api/admin/finance/analytics`, not `/analytics/summary`). No code changes made. This branch is done; the only remaining step project-wide is the owner's review of `launch-prep`.

## Check-in (2026-09-25, 4th firing) — `feature/finance-payroll-expenses`

Fourth firing. Found the branch had drifted 1 commit behind `origin/launch-prep` (the results-publish-lock commit — "Publish button only when unpublished; lock teacher edits once published" — merged into `launch-prep` from the sibling `results-publish-email` branch after this branch's last sync; out of this branch's Finance scope). Merged `origin/launch-prep` in (clean, no conflicts) to keep the branch current, and pushed.

Fresh sanity pass on the merged state, clean DB: server boots cleanly, all three demo logins return 200, and the full Payroll & Expenses surface was exercised live end-to-end via curl on a running server — payroll rates GET, salary run generation with real staff entries (`/api/admin/payroll/salaries/generate`), marking a generated salary paid, staff loan creation and status update, expense request submission → approve → dispense (auto-creates the linked expense record, confirmed in `/api/admin/finance/expenses`), income logging, and `/api/admin/finance/analytics` reflecting the new totals correctly. Zero server-side errors throughout. Re-confirmed every admin-api.js `apiFetch` call for this area matches a live server.js route path exactly. No finance code changes were needed — this area remains fully built, tested, and working; only the merge-forward was pushed.

## Check-in (2026-09-25, 5th firing) — `feature/finance-payroll-expenses`

Fifth consecutive firing. Branch already an ancestor-match with `origin/launch-prep` (no drift this time, nothing to merge). Independent fresh-DB sanity pass: server boots clean, all three demo logins verified (200/200/200). Exercised the Payroll & Expenses API surface live via curl — rates GET, salaries list, loans list, expenses list, income list, `/api/admin/finance/analytics` — then drove the write paths: marked a generated salary paid, approved a pending expense request and dispensed an already-approved one via `/api/admin/finance/expense-requests/:id/decision` (dispense correctly auto-created the linked `expenses` row), advanced a loan's repayment status via `/api/admin/payroll/loans/:id/status`, and logged a new income entry. All returned correct data, zero server-side errors. Cross-checked every `apiFetch` call in admin-api.js against the live server.js routes — all match. No code changes needed; this area remains fully built, tested, and working. Only remaining step project-wide is the owner's review of `launch-prep`.

## Check-in (2026-09-25, 6th firing) — `feature/finance-payroll-expenses`

Sixth consecutive firing. Branch confirmed 5 commits ahead / 0 behind `origin/launch-prep` — no drift, nothing to merge. Independent fresh-DB sanity pass: server boots clean, all three demo logins verified (200/200/200), zero errors in the server log throughout. Exercised the full Payroll & Expenses surface live via curl, read and write paths: rates/salaries/loans/expense-requests/expenses/income GET lists, `/api/admin/finance/analytics`, marking a generated salary paid, creating a new expense request then driving it through `/api/admin/finance/expense-requests/:id/decision` for both `approve` and `dispense` (dispense correctly auto-created the linked `expenses` row with the right category/amount/date), creating a new staff loan, and logging a new income entry. All correct. No code changes needed — this area remains fully built, tested, and working.

## Check-in (2026-09-25, 7th firing) — `feature/finance-payroll-expenses`

Seventh consecutive firing. Branch confirmed 0 commits behind `origin/launch-prep` (all prior check-in commits are metadata-only, no code drift) — nothing to merge. Independent fresh-DB sanity pass: `node --check` clean on server.js/admin-api.js/teacher-api.js/student-api.js, server boots clean, all three demo logins verified via cookie session (200/200/200), zero server-side errors throughout. Exercised the full Payroll & Expenses surface live via curl: rates GET, salaries/loans/expenses/expense-requests/income GET lists, `/api/admin/finance/analytics`; then write paths — marked a generated salary paid, approved then dispensed a pending expense request via `/api/admin/finance/expense-requests/:id/decision` (`action` field; dispense correctly auto-created the linked `expenses` row with matching category/amount/date), created a new staff loan, logged a new income entry, and generated a new salary-run period (`/api/admin/payroll/salaries/generate` with an `entries` array built from the rates data, matching how admin-api.js drives it) which correctly created pending salary records without touching already-paid ones. Confirmed via `grep` that the HRM/Payroll and Income & Expenses sub-tabs in admin-portal.html (Monthly Salaries Processing, Salary Payment Schedule, Payroll Settings, Expense Requests, etc.) are real wired content sections with matching `data-tab` targets, not placeholder shells. No code changes needed — this area remains fully built, tested, and working. Only remaining step project-wide is the owner's review of `launch-prep`.
