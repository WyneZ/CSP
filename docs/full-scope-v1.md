# CSP ERP — Full Product Scope

*Status: DRAFT / hypothesis. Written before requirements were confirmed with
the actual user (my uncle-in-law, construction engineer at a small Myanmar
contractor). Treat every item here as a question to validate with him, not a
decided requirement. Update this file after the first real interview.*

---

## 0. Context assumptions (validate these first)

Assumed operating reality of a small Myanmar contractor. If any of these are
wrong, the scope changes significantly.

- 1-5 active construction sites at a time
- Store is currently run on paper ledgers and/or Excel
- A storekeeper at each site records material in/out by hand
- Site engineer requests materials verbally, by phone, or on paper slips
- Owner/manager wants to know: what's in stock, what was used, what it cost
- Internet at sites is unreliable; phones are more common than laptops
- Users have low-to-moderate computer literacy
- Currency is MMK; some imported material may be quoted in USD
- Materials use mixed units (bag, ton, cft, viss, piece) and conversions matter

---

## 0.5 What is already decided (do not relitigate)

These are settled in `CSP-ERP-working-agreement.md`. Everything else in this
document is open.

- Stack: Next.js + NestJS + PostgreSQL, modular monolith
- `tenant_id` on every table from the first migration
- Stock is an append-only ledger; current stock is always derived
- Money and quantities are `numeric`/`decimal`, with a currency column
- Audit columns on every table; deletes are soft deletes
- v1 ships to one real site; everything else waits for real usage

---

## 1. Module list — the full product

### 1.1 Foundation (infrastructure, not a user-facing module)
- Tenant isolation (`tenant_id` on every table)
- Authentication, session management, password reset
- Roles and permissions
- Audit columns + change history
- Soft deletes
- Backup and restore

**Roles (initial):** Admin/Owner, Project Manager, Site Engineer, Storekeeper,
Viewer/Accountant.

### 1.2 Master data
- **Projects / Sites** — name, client, location, start/end date, status,
  assigned staff
- **Materials** — code, name, category, base unit, alternate units +
  conversion factors, reorder level, standard rate
- **Units of measure** — with conversion table (bag ↔ ton, cft ↔ m³, etc.)
- **Vendors** — name, contact, address, payment terms, material price list
- **Users & staff** — who works on which site

### 1.3 Store / Inventory (the core)
- **Goods Receipt (GRN)** — material received at site, against a PO or direct,
  with delivery order reference and optional photo of the DO
- **Issue to work** — material issued out of store, against a requisition,
  recorded to a site/work item
- **Transfer between sites** — out of one store, into another, with in-transit
  state
- **Return to store** — unused material coming back
- **Stock adjustment / physical count** — reconcile counted stock against
  system stock, with a mandatory reason
- **Stock ledger** — append-only movement records; current stock is always
  derived, never a stored mutable number
- **Current stock view** — per site, per material, with movement history
- **Reorder alerts** — material below reorder level

### 1.4 Material Requisition
- Site engineer raises a requisition (material, quantity, needed-by date,
  purpose)
- Approval flow: draft → submitted → approved / rejected → issued (fully or
  partially) → closed
- Partial issue supported (request 100 bags, issue 60 now)
- Rejection requires a reason
- Requisition history per site and per requester

### 1.5 Procurement
- **Purchase Request** — raised when stock is insufficient for a requisition
- **Purchase Order** — vendor, materials, rates, delivery date, terms
- **Delivery tracking** — PO → GRN linkage, partial deliveries
- **Vendor invoice / bill entry** — three-way check against PO and GRN
- **Vendor price history** — what we paid this vendor for this material
  previously

### 1.6 Site operations
- **Daily Site Report** — date, weather, manpower count by trade, work
  completed, materials consumed, issues/delays
- **Site photos** — attached to DSR or to a material movement
- **Work items / activities** — optional breakdown so consumption can be
  attributed to a specific activity, not just the site

### 1.7 Labour (validate — often the biggest real pain point)
- Daily wage worker attendance per site
- Trade/skill categories and daily rates
- Subcontractor tracking — scope, agreed amount, progress payments
- Labour cost rollup per site

### 1.8 Equipment & machinery
- Equipment register (owned and rented)
- Assignment to site, transfer between sites
- Fuel consumption log
- Maintenance/service log and cost
- Rental cost tracking

### 1.9 Cost tracking
- Budget per project (by material category at minimum)
- Actual material cost from issued stock (valuation method must be decided:
  moving average vs FIFO — this is a real architectural decision)
- Labour and equipment cost rollup
- Budget vs actual variance per project
- Cost per activity, if work items are used

### 1.10 Reports & exports
- Current stock report (per site, per material, consolidated)
- Material consumption report (period, site, material)
- Requisition status report
- Purchase / vendor spend report
- Project cost summary
- Excel/PDF export for all of the above

### 1.11 Documents
- Attach delivery orders, invoices, photos to their source record
- File storage, retention, and access permissions

### 1.12 Administration
- Tenant/company settings (name, logo, currency, fiscal year)
- User management
- Reference-data management
- Backup schedule and restore
- Basic system health view

---

## 2. Practical constraints that shape the design

These are not features but they change how everything must be built. Validate
each with the uncle before committing.

- **Poor connectivity at sites.** If the storekeeper cannot record a movement
  during a network outage, the system will be abandoned and paper will return.
  Decide early: online-only, or offline-tolerant entry with later sync?
  Offline sync is expensive — do not build it unless it's genuinely required.
- **Mobile first for storekeepers and site engineers.** They will not carry a
  laptop around a site. Desktop is for the office/manager.
- **Burmese language UI.** Probably required for storekeepers. If so, plan the
  text layer early even if translation comes later.
- **Low computer literacy.** Fewer fields, bigger buttons, hard-to-misuse
  forms. Every optional field is a field that will be left blank.
- **Unit conversions are a real source of error.** Cement in bags but ordered
  in tons; sand in cft but delivered by truckload. Get this into the model
  from the start.
- **Trust is fragile.** If system stock and physical stock disagree once and
  the system can't explain why, users go back to paper. This is why stock must
  be an append-only ledger.
- **Data entry burden.** Every field added is work for someone at the site. If
  it isn't used in a decision or a report, it shouldn't exist.

---

## 3. Release plan

### v1 — Go live on one real site (target ~4-5 months)
Goal: replace the paper store ledger on one site. Nothing else.

- Foundation (auth, roles, tenant, audit)
- Master data: Sites, Materials + units, Vendors (name/contact only)
- Store: Goods Receipt, Issue to work, stock ledger, current stock view,
  movement history
- Material Requisition + approval flow (partial issue supported)
- Basic stock and consumption report with Excel export
- Mobile-usable screens for GRN, Issue, and Requisition

Explicitly **not** in v1: procurement, DSR, labour, equipment, cost tracking,
photo attachments, multi-site transfer, offline mode.

**Success criteria:** the storekeeper on one site uses it daily for four
consecutive weeks and stops maintaining the paper ledger.

**v1 internal milestones — show the uncle at every one, not just at the end:**

| # | Milestone | Deliverable |
|---|---|---|
| 1 | Walking skeleton | Log in, add a material, record a store-in, see current stock |
| 2 | Store loop | Goods receipt + issue + movement history + stock view |
| 3 | Requisition | Request → approve → issue, partial issue supported |
| 4 | Site-ready | Mobile-usable screens, backup, Burmese labels, Excel export |

Waiting four months for feedback is the single biggest risk in this plan.
Hearing "that's not how we record it" at milestone 1 saves two thousand lines
of code.

### v2 — Only after v1 is genuinely in daily use
- Purchase Request → Purchase Order → GRN linkage
- Vendor price history and spend report
- Transfer between sites, return to store, physical count
- Daily Site Report + photo attachments
- Reorder alerts
- Second site onboarded

### v3 — Once two or more sites are running
- Cost tracking: budget vs actual, valuation method, cost per project
- Labour attendance and subcontractor tracking
- Equipment register and fuel/maintenance logs
- Full report suite
- Multi-tenant onboarding if a second contractor appears

### Deferred indefinitely
Full BOQ estimation, accounting-system integration, payroll processing,
native mobile app, offline sync (unless v1 proves it's mandatory), client
portal, tender management.

---

## 4. Questions to ask the uncle before building anything

**Current process**
1. Walk me through what happens today from "engineer needs cement" to "cement
   leaves the store." Who writes what, on what?
2. What records do you keep now — books, Excel, photos of slips?
3. Which part of this loses the most time or causes the most arguments?

**Pain and priority**
4. If one thing were fixed tomorrow, what would you pick?
5. Has material gone missing or been unaccounted for? How was it discovered?
6. What number do you most often need and can't get quickly?

**Scale and people**
7. How many sites are active at once? How many will there be in two years?
8. Who would actually type into this — name them, and what phone do they use?
9. Can they read English, or does it need to be in Burmese?

**Reality check**
10. Is there mobile data at the sites? Does it drop out?
11. Which materials cause the most unit-conversion confusion?
12. Who approves a material request today, and what happens when they're
    unreachable?
13. If this system existed and worked, what would you stop doing on paper?

**Boundary**
14. Do you want purchasing and vendor management in this, or only the store?
15. Does anyone need to see cost, or only quantities?

---

## 5. Open decisions still to make

Track these; each one needs an ADR before it's built.

| Decision | When it must be made |
|---|---|
| Prisma vs Drizzle | Before the first migration |
| Online-only vs offline-tolerant entry | Before milestone 2 — changes everything if offline is required |
| Burmese UI: now or later | Before milestone 4 |
| Stock valuation method (moving average vs FIFO) | Before v3 cost tracking, but the ledger must not block either |
| How unit conversions are stored and applied | Before milestone 2 |
| Where files/photos are stored and backed up | Before v2 |

## 6. How to use this document

- Do not build from this document. Build from what the uncle says after the
  interview.
- After the interview, rewrite sections 1-3 and delete anything he didn't
  confirm a need for.- Anything he says with real frustration in his voice goes into v1. Anything
  he says "would be nice" goes to v3 or gets deleted.
- Revisit this file at each release boundary, not more often.
