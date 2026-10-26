# Finance: SchoolsFocus vs our site — where they differ

Compared on 2026-10-26. "SF" = SchoolsFocus (uniquegroupofschools.schoolsfocus.net), "Ours" = admin-portal.html + admin-api.js + server.js on branch `launch-prep`.
The word-for-word capture of SF is in `schoolsfocus-finance-capture.md` next to this file.

Legend: ✅ same · 🟡 partly the same · ❌ missing or different · 🚧 ours shows "Coming Soon"

---

## 0. The menu itself

| SF menu item | Ours | Note |
|---|---|---|
| Fees / Bursary (5 items) | ✅ all 5 | same names, same order |
| Fees Logs & Reports (3 items) | ✅ all 3 | |
| Income & Expenses (7 items) | ❌ only 4 | **missing: Bank Balance Report, Cash Flow Statement, Account Ledger** (SF has an Account Ledger here *and* under Accounting) |
| HRM / Payroll (4 items) | ✅ all 4 | |
| Store & Inventory (11 items) | ❌ 10 | **missing: Inventory Reports** |
| Accounting (9 items) | ✅ all 9 | |

## 1. The biggest difference: how fees are built

SF builds fees from a **fee template** ("Publish / Manage Class Fees"): one invoice called "SCHOOL FEES | FIRST TERM | 2026-2027 ACADEMIC SESSION" that holds **many fee items** (SCHOOL FEES, SCHOOL BUS, TEXTBOOK & STATIONARIES, MID-DAY-MEAL, END OF THE YEAR PARTY, EDUCATIONAL RESOURCES, P.T.A, CLUB ACTIVITY), each with its own amount and a destination bank account. One template is shared by several classes, it **auto-generates** an invoice for every student in those classes (and for new students who join later), it carries a discount, a "Part Payment" switch and a "Show Invoice Breakdown to Students / Parents" switch.

Ours has **no templates and no fee items**. "+ New Invoice" creates one invoice with **one Fee Type** (Tuition Fee / Bus Fee / Development Levy / Exam Fee / Sports Fee / Other) and one amount, for one student or one whole class. Nothing is auto-generated for students who join later.

Everything downstream follows from this: SF's invoice popup lists the fee items and bank details; ours can't. SF's "Fees Summary By Fee Items" card can't exist on ours.

## 2. Fees / Bursary

### Invoice List
| | SF | Ours |
|---|---|---|
| Filters | Class*, Class Arm*, Fees Session*, Fees Term*, View Invoices* (by fee title), Filter By Invoice Type (Mandatory / On-demand / Other), Filter By Payment Status (Unpaid / Partly Paid / Total Paid) | Class, Academic Term, Payment Status (All / Paid / Part Paid / Unpaid / Overdue) ❌ no Class Arm, no Session, no fee-title or invoice-type filter |
| "+ New Invoice" | dropdown: **Quick Student Invoice** · **Publish / Manage Class Fees** | one popup "New Fee Invoice" (single student or whole class, one fee type) 🟡 |
| Cards above the list | **Total in list** · **Total Paid (with %)** · **Total Due (with %)** | ❌ only a line of text under the table |
| Export / Print | Export List (DOC / CSV / XLS / XLSX) · Print List (List Only / With Summary) | ❌ none |
| Columns | # ☐ · Student · Fee Class · Invoice ID · Invoice Title · Total · Paid · Due · Status · Created · Collection · Action | # · Student · Class · Fee Type · Amount · Paid · Balance · Due Date · Status · Action ❌ no Invoice ID, no Created date, no tick boxes |
| Status icon | crossed-eye = invoice hidden from parent | ❌ no show/hide-from-parent |
| Row action | ⋯ → **View Invoice** · **Download / Share Invoice** | **View** (opens fee history) · **Pay** (record payment) 🟡 |
| Bottom | class totals table (Total / Discount / Net / Paid / Due) and **Fees Summary By Fee Items** + Print Summary | ❌ |
| Invoice popup | full printable invoice: school letterhead, student photo, Reg No, "Invoice Generated at", "By", Due Date + Overdue tag, fee-item table with destinations, **Bank Details** table, red bank-payment NOTE, buttons **Pay Now · Upload Payment Proof · Download / Share · Print · Print (POS) · Close** | ❌ no printable invoice at all — "View" shows a fee-history list |
| Recording a cash/bank payment | done from the "Collection (Record Offline Or Direct Bank Payment)" column | ✅ we have it — "Pay" → Record Payment (amount, method, reference, note) |

### Class Invoice History
| | SF | Ours |
|---|---|---|
| Filters | Fees Session*, Fees Term*, Class*, Class Arm* (+ invoice type, invoice titles, Active/Deactivated) | Academic Term*, Class* ❌ no arm / session / status |
| What a row is | **one row per student** with counts and totals: Mandatory Invoices, On-Demand Invoices, Total Invoiced, Total Discount, Net Total, Paid, Due, [View Invoices] | **one row per invoice** (Student, Fee Type, Amount, Paid, Balance, Due Date, Status) ❌ different shape, no per-student roll-up, no View button |
| Extras | Quick Links: **Assign / Manage Student Tags** · **Manage & Publish Fees** · **Print List** | ❌ none |

### Family Fees History
| | SF | Ours |
|---|---|---|
| Tabs | Family Fees & Wallets · Fees Wallet List & Balances · About Fees Wallets | ✅ same three tab names |
| How a family is formed | real parent accounts (father / mother, phone, email, Active badge) | grouped by **parent email** on the student record 🟡 |
| Count cards | **115 Families · 75 With 1 Parent · 40 With 2 Parents · 155 Total Parents** | Families · With Balance Due · Total Outstanding ❌ different cards |
| Filter | Family List Type (5 options: all / active wards / graduated or left …) | ❌ none (search only) |
| Bulk actions | Action on selected (Activate / Deactivate parents or wards) · Export List · Advanced Export · Advanced Filter | ❌ none |
| Row | Parents · Wards (with class + Active/Inactive) · Manage Wards / Members · View Family · **Fees Records** · **Family Fees Account / Wallet** | Parent email · Wards · Total Invoiced · Paid · Balance · **Fees Records** 🟡 |
| Fees Records popup | full invoice list for the whole family with filters, Total / Paid / Due cards with %, export, print | ✅ we show the family's invoices, totals and a Record Payment button — simpler, but works |
| Wallet tab | real (empty here because SF's SchoolRemit gateway isn't on) | 🚧 Coming Soon |
| About tab | marketing text about dedicated bank accounts per family | our own short explanation 🟡 |

### Review Payment Proofs
| | SF | Ours |
|---|---|---|
| Who submits | **parents** upload a proof from the invoice ("Upload Payment Proof"); admin reviews | **admin types it in** ("Log a Reported Payment") then approves it ❌ parents can't submit |
| Where you review | the Online Payment Transactions Log filtered to "Payment Proof Under Review" | our own "Pending Review Queue" with **Approve / Reject** ✅ works |
| Attachment | the proof file is attached | ❌ no file upload |

### Verify Payment Status
| | SF | Ours |
|---|---|---|
| Opens | a popup straight from the menu | a page with a "Verify Payment" button that opens the popup 🟡 |
| Popup | Payment Method* (Bank Payment) · Payment / Transaction Reference* · **Verify Transaction** | ✅ same fields and button wording |
| What it does | checks the reference with the payment gateway / bank | looks up a payment **already in our own records** by reference and marks it successful ❌ no gateway check — a reference nobody entered can never be verified |

## 3. Fees Logs & Reports

### Successful Payments
| | SF | Ours |
|---|---|---|
| Filter | Fees Received Between* · Payment Channel (All / Bank / Bank Payment / Cash / Cheque / Others) · View Report | ✅ same; our channel list differs slightly (Bank Transfer, Card Payment instead of Bank / Others) |
| Columns | # · Payment Date & Time · Payment for · Class · Invoice Title · **Invoice Code** · Payment Amount · **View Invoice** · Payment Mode · Received / Confirmed By · **Transaction ID** · **Gateway Tx Reference** · **GL Status** | # · Payment Date & Time · Payment for · Class · Fee Type · Amount · Payment Method · Reference · Recorded By 🟡 missing Invoice Code, View Invoice, Transaction ID, GL Status |
| Export | not seen (report wasn't run on SF — no 2026 data) | our **Export (All)** and **Export (Page)** both download the same CSV; ❌ no DOC / XLS / XLSX; pager buttons (« ‹ › ») do nothing |

### All Payment Attempts
| | SF | Ours |
|---|---|---|
| Status filter | All · Pending Payment Completion · Pending Response · Transaction Successful · Transaction Unsuccessful · Unknown · Payment Proof Under Review · Payment Proof Rejected | All · Successful · Pending · Failed 🟡 |
| Columns | # · Transaction · Initiated By · For · Fees Title · Gateway Tx Ref No · Payment Gateway / Channel · Transaction Amount · View Invoice · GL Status | # · Date · Student · Class · Fee Type · Method · Amount · Reference · Status 🟡 |
| Export | Export (All) ▾ Excel / Word / CSV · Export (Page) ▾ DOC / CSV / XLS / XLSX | ❌ none on this page |
| Footer | Total Successful : | ✅ Total Successful : |

### Fees Debtors
| | SF | Ours |
|---|---|---|
| Filters | Fees Session*, Fees Term*, Class*, Class Arm*, For Invoice Type*, For Invoice(s)*, Student Account Status* | Academic Term, Class ❌ |
| Columns | # · Name · Reg No. · Current Class · Total Unpaid Amount · Overdue · View Invoices ([Fees Invoice History]) · **Reminder ([🔔 Send])** | # · Student Name · Reg No. · Class · Invoices · Total Fees · Amount Paid · Balance Due · Due Date (+Overdue tag) · Action ([View]) 🟡 |
| **Send reminder to parent** | ✅ per student | ❌ **missing** |
| Print List | ✅ | ❌ |

## 4. Income & Expenses

### Expense Requests
| | SF | Ours |
|---|---|---|
| 4 cards | Total Requests · Pending Approval · Approved Awaiting Disbursement · Dispensed | ✅ same four, same wording |
| Flow | Pending → Approved → Dispensed (or Declined) | ✅ same (we call it Rejected) and dispensing creates an expense ✅ |
| Filters | Quick Date Filters (Today … Custom) · Session · Expense Head · Status (6) · Method | Status · Search 🟡 |
| Form "Make Cash Request" | Voucher ID (+Generate) · Expense Head* · Item* · Description* · Amount* · Transaction Date* · Method* · Requested By* | Title · Category · Amount · Reason 🟡 no voucher, item, method, date, requested-by |
| Bulk | "With Selected : Mark Dispensed" + pay-from account | ❌ one at a time |
| Export | Export (All) / Export (Page) | ❌ (Refresh only) |

### Expenses
| | SF | Ours |
|---|---|---|
| Tabs | Expenditure · Expense Heads / Categories | ✅ same |
| Cards | Total Expenditure · Avg Per Entry · Today · This Month | ✅ same |
| Post | **Post Expenses ▾ Single Posting / Multi Posting / Import from Excel** | "+ Post Expense" (single only) ❌ no multi, no Excel import |
| Form | Voucher ID · Expense Head* · Item* · Description* · Amount* · Transaction Date* · Method* · Paid To* · Paid From · Attachment / Receipt · Approved By · **Save & Post to Ledger** / Save | Category · Description · Amount · Date ❌ no paid-to, paid-from, method, receipt upload, approver, ledger posting |
| Filters | Quick Date · Session · Head · Paid From · Method; By Item / By Voucher toggle | Category · Search 🟡 |
| Summary | By Categories · By Account · Monthly Trend + Print Summary | By Category only 🟡 |
| Heads tab | heads with **code**, **ledger account**, **sub-heads (items)**, Bulk Import | name only, add / remove 🟡 |

### Income
Same pattern as Expenses: ✅ tabs and the 4 cards match; ❌ no Import from Excel, no voucher / method / received-from / paid-into / receipt / "Save & Post to Ledger"; filters are Category + Search only.
**Big functional gap:** on SF every fee payment lands in Income automatically under "School Fees" (2,791 entries). On ours, **fee payments never reach Income** — Income only holds what someone types in by hand, so Income totals and Analytics leave out all school fees.

### Income & Expenses Analytics
| | SF | Ours |
|---|---|---|
| Filter | Period (10 choices) · Account · View Analytics | ❌ none — always all-time, with a Refresh button |
| 3 figures | Total Income · Total Expenses · Net Balance (Surplus) | ✅ same |
| Tabs | Expense Heads · Income Heads · **By Account** · Monthly Trend | Expense · Income · Monthly Trend ❌ no By Account |
| Data | includes fee payments | ❌ excludes fee payments (see Income) and paid salaries |

### Bank Balance Report · Cash Flow Statement · Account Ledger (under Income & Expenses)
❌ **Not on our site at all.** SF has: Bank Balance Report (Total / Bank / Cash balance cards + per-account opening balance, income, expense, current balance); Cash Flow Statement (Inflows: Income, Transfer in, Adjustments; Outflows: Expenses, Transfer Out, Adjustments; Net Cash Flow); Account Ledger (pick account + dates + session).
We do have an Account Ledger under Accounting, but it only reads manual journal entries.

## 5. HRM / Payroll

### Monthly Salaries Processing
| | SF | Ours |
|---|---|---|
| Employee Type | Teacher · Accountant/Bursary Officer · Librarian · Registrar · Transport Manager · Hostel Manager · Store Manager · General Staff / Others · Admin | Teacher · Non-Teaching Staff (Admin) · All Staff 🟡 |
| Grid columns | Employee · **Grade Level & Step** · **Salary Bank** · Basic Salary · Allowances (**+Add** named lines) · Deductions (**+Add** named lines) · Total Allowances · Total Deductions · Net Salary · **Exclude** | Employee · Role · Base Salary · Allowances (one number) · Deductions (one number) · Net Salary · Status ❌ no named allowance/deduction lines, no grade, no bank, no Exclude |
| Save | Save Computed Salaries | ✅ Process & Save Salaries |

### Salary Payment Schedule
| | SF | Ours |
|---|---|---|
| Filters | Employee Type* · Salary Month* · Salary Year* · **Payment Channel*** (Cash + every Nigerian bank) | Employee Type · Month · Year ❌ no Payment Channel (we don't store staff bank details) |
| Action | (SF result didn't load — server down) | **Mark Paid** per row ✅; but marking paid does **not** create an expense ❌ so salaries never appear in Expenses / Analytics |

### Payroll Settings
| SF tab | Ours |
|---|---|
| **Salary Scale** — Grade Levels (Add Grade Level) + Grade Level Steps with Basic Salary (Add Grade Level Step) | renamed **"Pay Rates"** — one row per staff: Base / Allowances / Deductions / Save ❌ no grade levels or steps |
| **Salary Positions** — Add Position, Department, Default Grade Level, Status | 🚧 Coming Soon |
| **Staff Contracts** — Add Contract, Contract Type, Start/End Date, Status | 🚧 Coming Soon |
| **PAYE Config** — PAYE Engine on/off, Minimum Net Pay 46.67%, Payroll Bank Account, PITA tax bands (Pension 8% / 10%, NHIS 1.75%, NHF 2.5%, CRA ₦200,000, 6 bands) | 🚧 Coming Soon |

### Staff Loans & Advances
| | SF | Ours |
|---|---|---|
| Tabs | All Loans · Loan Settings | ✅ same names; Loan Settings is 🚧 Coming Soon on ours |
| Button | **+ Apply for Loan** | "Add Loan / Advance" 🟡 |
| Types | Loan · Salary Advance · Grant (non-repayable) | Loan · Salary Advance ❌ no Grant |
| Statuses | Pending · Reviewed · Approved · Active · Settled · Rejected (an approval flow) | Outstanding · Repaying · Repaid ❌ no approval step |
| Form | Staff Type, Staff Member, Loan Type, Amount (+ "effective limit"), Purpose, Disbursement Bank, repayment months / start month / year, **Run Payroll Checks**, guarantor (name, relationship, phone, email), supporting document | Staff, Type, Amount, Monthly Deduction, Reason 🟡 |
| Columns | Loan Code · Applicant · Type · Amount Req. · Amount Approved · Balance · Status | Staff · Type · Amount · Monthly Deduction · Reason · Status · Issued ❌ no balance tracking |
| Repayment | deducted through payroll | ❌ monthly deduction is stored but **not** taken off salaries automatically |

## 6. Store & Inventory

| Page | SF | Ours |
|---|---|---|
| Visit Storefront | opens the real public shop (/storefront) in a new tab | an in-portal preview of products / banners / sections 🟡 |
| Point-of-Sale Terminal | **Open Shift** required before selling; Recent Sales / Shifts / All Orders; multiple sale tabs (Sale 1, + New Sale); barcode scan; search by name/SKU; Walk-in Customer; Void; CHARGE; payment note | product grid, cart, customer name, discount, payment method (Cash / Card / Bank Transfer), Complete Sale 🟡 no shifts, no barcode, no multiple open sales, no void |
| Orders & Sales | filters: Order Status (10), Payment (5), Fulfilment (10), Fulfilment Type (Delivery / Pickup / Digital), Channel (Online Store / POS), From/To, search; **Bulk actions** (Mark as processing / fulfilled / Cancel / Mark as refunded); POS Terminal · Export · Refresh | search only + "New Sale (POS)" 🟡 |
| Products | filters Status (Draft / Published / Archived), Visibility (Public / Logged-In only / Private), Type (Physical / Digital), Category; **New Product · Bulk Import**; bulk update status, **bulk discount** add/remove; image column | category filter + search; Add Product 🟡 no images, no visibility / type / draft, no bulk import or bulk discount |
| Categories | Status + Visibility filters, drag-sort, New Category | add name + description 🟡 |
| Inventory & Supply | 8 sub-tabs: Stock Movement · Stock Valuation · Low Stock · Stock Adjustment · **Purchase Orders** · **Goods Received (GRN)** · **Vendor Bills** · **Contacts (Vendors)**; Export CSV | Stock Levels (low-stock tick) + Recent Stock Movements + adjust 🟡 ❌ no purchase orders, GRN, vendor bills, valuation |
| Inventory Reports | 7 tabs: Stock Movement · Stock Valuation · Requisition Analysis · Stock Adjustments · GRN / Receipts · Low Stock · POS Shifts | ❌ page missing |
| Store Settings · Storefront Banners · Storefront Homepage Sections · Internal Requisitions | ⏳ not captured — these pages time out on SchoolsFocus's server every time (Cloudflare 522) | ours: settings form (name, currency, low-stock, tax %, email); banners table; sections table; requisitions with status filter — can't be compared until SF loads them |

## 7. Accounting

The big idea on SF: an **Auto-Posting** switch ("When enabled, fee payments, payroll, storefront sales, and requisitions automatically post to the General Ledger"). It is **switched OFF** for this school right now, so SF's ledger is empty too — but the wiring exists. Ours has no such wiring at all: the 9 accounting pages only ever see **manual journal entries**.

| Page | SF | Ours |
|---|---|---|
| Chart of Accounts | 7 tabs: **Chart of Accounts · Expense Heads · Income Heads · Operating Accounts · Auto-Posting Config · Period Management · Currencies**. 43 ready-made accounts in a tree (1000 Assets → 1100 Cash, 1200 Bank, 1300 Inventory, 1400 Receivables, 1500 Staff Loans Receivable; 2000 Liabilities → Payables, WHT, VAT, PAYE, Pension, NHIS, NHF; 3000 Equity / Fund Balance; 4000 Revenue → 4100 School Fees Income … 4320 POS Sales; 5000 Expenses → 5100 Salaries … 5500 Discount Allowed). Columns: Code · Account Name · Type · Source (System) · Parent Account · Posting (Group / Postable) · Status. Filters Account Type + Status, Print / Export | one flat list: Code · Name · Type · Normal Balance · Status; type filter + search; Add Account 🟡 no parent/child tree, no Group vs Postable, no starter accounts, none of the 6 extra tabs |
| Auto-Posting Config | map each fee bank account → a CoA asset account; "Enable Auto-Posting" | ❌ none |
| Period Management | lock a session / term so no backdated entries can be posted | ❌ none |
| Currencies | base NGN + add foreign currencies | ❌ none |
| Journal Entries | list with Status (Draft / Posted / Reversed) and Type (Manual, Accrual, Opening Balance, Adjustment, Fee Payment, Payroll, Storefront Sale, POS Sale, Requisition, Vendor Invoice, Vendor Payment, Bank Recon, Accrual Reversal) filters, date range; **Trial Balance** shortcut; **New Entry ▾ Import from Excel**; Print / Export (CSV / Excel / DOC); columns Entry Code · Date · Description · Type · Debits · Credits · Status · Created By · Posted By | New-entry form (date, memo, debit/credit lines, must balance) + Posted Entries list ✅ the core works; 🟡 no draft/reverse, no types, no filters, no import/export |
| Account Ledger | Account* (searchable) · From Date* · To Date* · Load Ledger · Back to Journal | Account picker only, running balance ✅; 🟡 no date range |
| Trial Balance | "As at Date*" + Generate | always all-time totals, debit = credit check ✅; 🟡 no as-at date |
| Contacts, Bills & Invoices | 5 tabs: **Contacts · Vendor Bills (AP) · Customer Invoices (AR) · Aged Payables · Aged Receivables**; contact columns Code · Business Name · Type · Contact Person · Phone · Email · Terms (Days) · Status | 2 cards: Contacts (Name, Type, Email, Phone) and Bills & Invoices (Doc #, Type, Contact, Issue / Due Date, Amount, Status) 🟡 no aged (30/60/90-day) reports, no payment terms |
| Budgets | "Budget Periods": Create Budget, Status filter, Budget Name · Period · Status · Lines | one row per account: Period · Account · Budgeted · Actual · Variance ✅ works (simpler); 🟡 no multi-line budgets |
| Bank Reconciliation | **New Reconciliation** per account and month: Account · Period · Opening · Closing · Status · Opened | type in bank lines and tick "reconciled" 🟡 no opening/closing balance per period |
| Tax & Compliance | 6 tabs: **Overview · Tax Remittances · Payroll Remittances · Tax Codes · Tax Types · Regulators**. Overview by month: Payroll Obligations (PAYE Tax, Pension, Health Insurance, Housing Fund — employee / employer / total owed / status / date remitted / reference / View Sources) and Tax Code GL Balances (VAT Payable 2180, WHT Payable 2170 — accumulated / remitted / outstanding / View Ledger) | a simple tax-records log (Period, Tax Type, Amount Due, Amount Paid, Status, Due Date) 🟡 |
| Financial Reports | a **report hub** of ~20 report cards: Fees Payment Report · Termly Class Invoice History · Family Fees History · Termly Debtors List · Fee Debtor Aged Analysis · Debtor Group Analysis · Income Records · Expense Records · Income & Expenses Analytics · **Income & Expenditure (P&L)** · **Balance Sheet** · Trial Balance · Aged Receivables · Customer Invoices (AR) · Contacts Hub · Aged Payables · Vendor Bills (AP) · Staff Loans & Advances · Payroll Remittance Schedules · Tax Liabilities Overview · Inventory Reports · Gateway Settlement Log | one page: Total Income · Total Expense · Net Income + Total Assets / Liabilities / Equity 🟡 no P&L for a date range, no proper balance sheet, no report hub |

---

## 8. Short list — what to fix first

1. **Fees → Income link**: every successful fee payment should create an Income entry ("School Fees"), so Income, Analytics and Cash Flow show real money. Same for paid salaries → Expenses and store sales → Income. (Later: SF-style Auto-Posting into the ledger.)
2. **Fee templates with fee items** (Publish / Manage Class Fees) + auto-generate per class, and a **printable invoice** (letterhead, items, bank details, Print / Download).
3. **Send reminder** on Fees Debtors.
4. Missing pages: **Bank Balance Report, Cash Flow Statement, Account Ledger** (Income & Expenses) and **Inventory Reports**.
5. **Parents upload payment proofs** (instead of admin typing them in).
6. Filters SF has on nearly every fee page: **Class Arm, Fees Session, invoice type, Active/Deactivated**.
7. Export DOC / CSV / XLS / XLSX + Print on lists (ours: CSV on one page only; pager buttons are dead).
8. Payroll: named allowance / deduction lines, Exclude, grade levels & steps, staff bank / payment channel, PAYE.
9. Loans: approval flow, Grant type, balance tracking, deduct through payroll.
10. Coming-Soon tabs to build: Fees Wallet List, Salary Positions, Staff Contracts, PAYE Config, Loan Settings.

---

## 9. Status after the rebuild (2026-10-26)

All ten items above are done, along with every per-page gap listed in sections 0–7. Every Finance page is now built by `finance-ui.js` and the `finance-*-admin.js` scripts, backed by the `finance-*.js` server modules. It keeps the site's own look.

- **Menu**: matches SF, including Bank Balance Report, Cash Flow Statement, Account Ledger (Income & Expenses) and Inventory Reports.
- **Fees**:
  - Templates (Publish / Manage Class Fees) with fee items, auto-generation and self-generation.
  - Printable invoice with bank details.
  - Filters: Class Arm, Session, Term, type and Active/Deactivated.
  - Family wallets, debtor reminders by email, and payment proofs (admin side and pupil portal).
  - Every fee payment flows into Income.
- **Income & Expenses**:
  - Heads with sub-heads (items) and a ledger account for each head.
  - Expense requests: approve, then dispense.
  - Multi-entry and Excel import.
  - Operating (bank/cash) accounts with transfers and adjustments.
  - Bank Balance Report, Cash Flow Statement and Account Ledger.
- **Payroll**:
  - Grade levels and steps, positions, contracts, staff payroll profiles, and named pay items.
  - PAYE (Nigerian bands) with pension, NHIS and NHF.
  - Exclude option, schedule with payslips, and paid salaries flow into Expenses.
  - Loans with review → approve → disburse, guarantors, and repayment through payroll.
- **Store & Inventory**:
  - POS with shifts, several open sales and barcode/SKU search.
  - Order filters and bulk actions.
  - Products with status, visibility, type, image, discount, import and bulk update; categories with reordering.
  - Inventory & Supply: movements, valuation, low stock, adjustment, purchase orders, goods received (stock, average cost and vendor bill) and vendors.
  - Inventory Reports, store settings, banners, homepage sections and requisitions (approve → issue).
- **Accounting**:
  - Chart of Accounts with the 43 SF accounts and 7 tabs: Expense/Income Heads, Operating Accounts, Auto-Posting Config, Period Management and Currencies.
  - Journal entries: draft/post/reverse and Excel import.
  - Ledger and Trial Balance as at a date.
  - Contacts with AP/AR bills and invoices, payments and ageing.
  - Budgets (budget vs actual), bank reconciliation, Tax & Compliance (6 tabs), and the Financial Reports hub (P&L with optional budget, Balance Sheet, fee ageing, debtor groups, payroll remittance).
- **Pupil portal**: new School Fees page with invoices, print, "I Have Paid" proof upload and self-generated fees.
- **Old demo chart of accounts**: folded into the SF codes by a one-time migration (`fin_coa_v2`). Entries, budgets and links move with each account.

Still different from SF:
- No online payment gateway is connected, so the Gateway Settlement Log only explains this.
- SF's four storefront pages that timed out during capture (Store Settings, Banners, Homepage Sections, Internal Requisitions) were built from the menu names, not from a word-for-word copy.
