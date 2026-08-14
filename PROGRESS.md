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
