# CCLN — Career Connected Learning Network

A workforce-development platform connecting Kansas students, employers, colleges, and local workforce boards around paid internships that earn academic credit.

The program launches city by city: the administrator secures a local workforce board, then a college, then opens the market to students and local businesses. The board's $20/hour wage reimbursement is what makes it work — and the pause while a student waits on their board eligibility interview is the gap this platform exists to close.

**Status: mockup with real foundations.** The UI is a demo running on seeded fixtures, but it reads through the same domain layer and repository contracts a production build would use.

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # domain, data, and service unit tests
```

### End-to-end and accessibility tests

```bash
npx playwright install chromium   # once
npm run build                     # the suite runs against a production build
npm run test:e2e
```

They run against `next start` rather than `next dev` because the things they
assert differ between the two — the CSP drops `unsafe-eval` in production and
HSTS is only set there, so testing the dev server would verify a configuration
nobody deploys.

Accessibility is checked with [axe](https://github.com/dequelabs/axe-core)
against WCAG 2.1 A and AA on every page, plus states a static scan would miss:
an open modal, a form showing a validation error, a sorted table. Automated
tooling catches roughly a third of WCAG issues — it finds missing labels,
contrast failures, and broken ARIA, but it cannot tell you whether a screen
reader user can actually complete a booking. That still needs a person.

One caveat worth knowing before you run them: the demo store lives in the
server process, so `e2e/booking.spec.ts` permanently books the seed's only
bookable application. Restart the server to reseed.

## Start here

- [`docs/product-vision.md`](docs/product-vision.md) — what the platform is for, who it serves first, and where the vision does not yet match the build
- [`docs/user-story.md`](docs/user-story.md) — the end-to-end lifecycle across all five actors, with open questions
- [`docs/security-and-data.md`](docs/security-and-data.md) — which privacy regimes apply, what cookies are permitted, and the data-minimisation rules

## Decisions made so far

| Decision | Choice | Notes |
|---|---|---|
| Database | Postgres | Relational domain, cross-entity transactions, row-level tenancy |
| Primary customer | The platform administrator | Admin console is the product; the other portals feed it |
| Tenancy root | The market (board + college + geography) | Admin launches markets; everything else belongs to one |
| The workforce interview | A wage-subsidy eligibility determination | Not compliance — the board reimburses the business $20/hr |
| The college's role | Local operator and intermediary | Verifies students, helps businesses write postings, grants credit |
| Scope | College-level credit | Defined by the **credit, not the school** — a dual-enrolled high school student earns college credit and is in scope. The high school itself is not yet modeled |
| Who participates | Students earning college credit | Includes dual/concurrent-credit high schoolers. No adult job seekers or unaffiliated career-changers |
| Opportunity tracks | Standard (3 credit) and micro (1 credit) | Micro follows the Parker Dewey project model |
| Workforce clearance | Per applicant, per job | Not portable — every standard application gets its own board interview |
| Demo data | Entirely fictional organizations | Real Kansas cities and counties; no institution, board, or business is real |
| Payments | Out of scope | The platform tracks subsidy obligations but moves no money |
| Current phase | Pitch / stakeholder demo | Polished clickable flow over a real domain layer |

## Architecture

The five portals are five views onto **one workflow state machine**, not five independent applications.

```
src/domain/      Pure TypeScript. Entities, guarded transitions, workflow
                 profiles per track, credit accumulation, match scoring,
                 PII disclosure. No UI, no database.
src/auth/        Session resolution behind a provider interface. Replacing
                 simulated sign-on touches this and nothing else.
src/data/        Repository contracts + in-memory seeded implementation;
                 Store/UnitOfWork for writes; Postgres schema and SQL
                 scoping alongside, not connected.
src/services/    Write paths (executeTransition for existing records,
                 creation for new ones), input validation, notification
                 dispatch and the outbox that records it.
src/lib/         Derived views (what's stuck, market health, funnel) so no
                 portal computes its own answer.
src/components/  Component library, rendered at /design.
src/app/         Route segments per portal over a shared shell.
```

Properties worth knowing:

- **No database.** Everything runs off seeded fixtures. The Postgres schema and its scoping SQL are written and tested; connecting is an adapter swap.
- **One write path.** `executeTransition` is the only way state changes: guard, persist, audit, and notify in a single transaction, with optimistic concurrency.
- **Sign-on is simulated, sessions are not.** An httpOnly cookie resolves to a membership, which carries the role and market every read is scoped by. Only the credential check is fake.
- **Portals render buttons from `availableTransitions`**, so permission logic cannot drift across five surfaces. Adding a transition to the table makes its button appear everywhere it applies without editing a page.
- **Authorization is re-checked on the server.** Server Actions accept direct POSTs, so a button being absent from a page proves nothing.
- **One action per portal, each with its role hardcoded.** Not one generic action taking a portal name — a caller who supplies their own role supplies their own authorization. The client names a target status and never a patch; anything a transition writes is derived server-side.
- **Notifications are queued inside the transaction and sent after it commits.** A send that fails after a commit is retryable; one that succeeds before a rollback has told someone about work that never happened. `/admin/outbox` shows what was delivered, queued, and undelivered — the audit log says what changed, the outbox says whether anyone was told.
- **Who hears about what lives in one table.** `notification-policy.ts` maps each status an application reaches to the parties told and what each is told; `templates.ts` holds the wording. A transition notifies the right people without its call site listing them, which is what stops a lifecycle having messages for the interesting steps and silence for the rest.

## The four state machines

Four things have a status and rules about who may change it: an **application**, a **student's** enrolment standing, a **posting**, and an **organization's** vetting. They share one engine (`domain/machine.ts`) that resolves every move the same way — market isolation, ownership, does the transition exist, is the role permitted, does the guard pass, and may an administrator override it (role and guard yes, market isolation never, and never without a reason).

| Machine | Owned by | Gates |
|---|---|---|
| Application | all five portals | the placement itself |
| Student | the college | whether a student may apply at all |
| Posting | the college, with the employer's half | what students can see |
| Organization | the administrator alone | whether anything can transact |

The application machine was the only one modelled for a long time, and that left two claims in the interface with nothing behind them:

- the admin console said *"nothing transacts until an organization is approved"* — a business at `applied` could post, take candidates, and approve hours a board would reimburse;
- the college portal said *"students cannot apply until verified"* — applying worked regardless.

Both were missing for the same reason. The status existed and the queue rendered it, but nothing could move it, so nothing could depend on it either. `canApply` and `canTransact` are now the single definitions, checked in `creation.ts` where applications and postings are made.

**An administrator sees moves they would have to override**, and the refusal names the guard rather than only asking for a reason — on an admin-only machine like vetting, the administrator is the only caller a guard can ever refuse, so without that they are asked to justify a decision the product declined to describe.

## Hours

Reimbursement is hourly, so logged hours are the basis of a funding claim and not only an academic record. The platform is the system of record for them (Q19).

Hours are the one record every party needs and none of them owns alone, so the write path is deliberately split across two roles:

| Party | Does | Sees |
|---|---|---|
| Student | Logs the week — a **claim**, not an approval | Their own weeks, including why one was sent back |
| Employer | **Validates it.** Approves or sends it back with a reason | The placements they supervise, with the work descriptions |
| College | Awards credit against it | The weekly record, because credit judges work done |
| Board | Reimburses against it | Hours and periods — **not** the work summaries |

**The employer's approval is the whole evidentiary basis.** They are the only party who can attest the student was there — not the college, which awards credit but was not present, and not the board, which pays but was not present either. Self-reported hours nobody countersigned are not something public money can be reimbursed against.

Weekly rather than daily, because a week is the period a board reimburses against and a daily grid is a data-entry burden for precision nobody downstream consumes. Only the standard track has a timesheet: a micro-internship is bought as a deliverable for a fixed fee, and billing it by the hour would misstate the agreement in both directions.

`hoursLogged` and `hoursApproved` on the application are a cache over the entries, rewritten inside the same transaction that writes an entry. They are cached rather than derived because the transition guards and the credit calculation take an `Application` and no repository — recomputing on read would mean handing every guard a database. The invariant is pinned in `timesheet.test.ts` against both the seed and the write path, because a cache that can drift gets reported as "the board paid the wrong amount".

### Two things that fall out of it

- **Approved hours can exceed the authorized cap, and that is not a bug.** A supervisor approving a genuine week does not know what the board committed three months earlier. So the overage is surfaced on the board's console, not prevented — and the employer carries it. Reimbursing past the cap would overspend a finite allocation; dropping the hours would hide a bill the employer is about to receive. Naming it is the only honest option.
- **A placement cannot be completed over unreviewed weeks.** Closing it strands them: they reach neither the credit total nor the reimbursement claim, and a student cannot reopen a completed placement to chase them. The employer sitting on the queue is the one who can clear it, and completion is the moment they notice.

### Who sees what, and why not more

The board sees hours and periods; the work summaries are stripped before the rows reach it. Pricing a claim against an hour cap does not take a description of what the student built, and holding one would give a government agency a weekly diary of a named student's activity it has no need for — which, once held, is subject to retention and open-records questions it would rather not answer. Collect once, disclose per purpose. The redaction is in the repository, not the component: a field hidden on screen while the full row travels to the client is not withheld.

## Theming

A student should see their school, not a vendor. The student and college portals are white-labelled to the **education organization the student attends** — the college today, a dual-credit high school when secondary is modelled. The admin console and the board console are deliberately not themed: painting a board's oversight screen in one college's colours would misrepresent what the board is looking at.

**A partner controls a primary colour, a second colour, and a logo. Nothing else** — copy carries obligations, and a partner who can edit "the board must determine your eligibility" can misstate a funding rule in a way that traces back to the platform.

Their exact hex is not what renders. It seeds a hue, and every step of the ramp is *computed* to meet the contrast target its role requires (`src/theme/ramp.ts`), so an unusable combination is not reachable rather than warned about. `ramp.test.ts` sweeps all 360° at 5° steps and asserts every target, because a spot check passes on the day and fails the first time a college with an unusual brand signs up.

The second colour is not run through the same solver. A gold cannot be a text colour on white, and darkening it until it clears 4.5:1 turns it into a brown that is no longer the school's colour. Accents are a fill plus whichever ink reads on them, resolved together so a call site cannot pair them wrongly.

### What the checker does

Guaranteeing a readable result is half the job; the other half is saying so. A college that pastes its crimson and gets something deeper has no way to tell deliberate from broken, and enforcement without explanation reads as a product that ignored you. So the college portal carries a live checker (`src/theme/analyze.ts`) that reports:

- **what was adjusted**, naming both the submitted colour and the rendered one;
- **a colour that is really a second colour** — too light to carry text, and pointed at the accent slot where it works;
- **collisions with a hue this product has already spent on meaning** — critical, warning, success, and the micro track. Not a contrast problem, a semantic one: an accent eleven degrees from the amber used for "waiting nineteen days" competes with a signal an administrator reads at a glance;
- **two colours that will not read as two**, and which ink lands on the accent.

**Nothing blocks.** A school knows its own brand, and refusing a legitimate institutional colour is worse than explaining the trade-off. The seeded college is green and gold — an extremely common institutional pairing, and one that collides twice. It was kept rather than swapped for something that reports clean: a checker that only ever produces good news on the data it ships with has not been tested against anything.

## Email

Messages send through [Resend](https://resend.com) when configured, and are recorded either way.

```bash
cp .env.example .env.local   # then fill in RESEND_API_KEY
```

**Sending is off unless `RESEND_API_KEY` is set.** With it unset, every message is still rendered, recorded, and shown at `/admin/outbox` — nothing leaves the process. That is the opposite of how this codebase treats its other secrets, and deliberately: a missing upload key means broken security, while a missing email key means silence, and silence is the safe direction for a demonstration whose organizations are invented.

Three guards, in the order they matter:

| Guard | Variable | Effect |
|---|---|---|
| Off by default | `RESEND_API_KEY` | No key, no sending. The outbox records what would have gone out. |
| Redirect | `EMAIL_REDIRECT_TO` | Every message goes to one address instead of its real recipient, which is stated in the body. **Set this anywhere that is not production.** |
| Reserved domains | — | Addresses on `.example`, `.test`, `.invalid` are refused, not sent. |

That last one is not a nicety. Every seeded organization uses a `.example` address, which RFC 2606 reserves precisely so it cannot be delivered — so a configured deployment without this guard would bounce every message it sent, and a bounce rate like that is how a sending domain's reputation is destroyed. Refused messages appear in the outbox as undeliverable with the reason, rather than being retried forever.

The outbox states plainly whether "delivered" means an email left the building or a line hit a log. Conflating those would let an administrator believe a board was told when nothing was sent.

### Not wired, on purpose

- **Awarding credit across several placements at once.** It has to decide which completed projects an award consumes and where leftover hours go, which is the open credit-stacking question (Q21). Granting per placement works and does not prejudge it.
- **Interview slot publishing.** The board's "Publish slots" button. Slots already have a repository and optimistic concurrency; what is missing is the form and a rule about how far ahead a board may publish.
- **Editing a student profile.** "Update profile" on the student portal. It is a PII write path rather than a status change, so it wants field-level rules about what a student may alter after verification — changing your name after a college vouched for you is not the same as changing your available hours.
- **Uploads on a real surface.** The service is complete and tested — storage, scanning, signed URLs, access control — but only appears in the design gallery. Nothing yet decides which documents a placement actually requires.
- **Editing an approved week.** Correction today runs through rejection: a supervisor sends a week back and the student logs it again. That covers the case before sign-off. Amending a week *after* approval changes a figure a board may already have reimbursed, so it needs a supersede-with-audit-trail rather than an edit, and a rule about who may initiate one.

Assumptions standing in for unanswered questions are marked inline in the UI with the question number they resolve, and tracked in the user story doc.
