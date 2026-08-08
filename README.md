# Opportunity Ecosystem

A workforce-development platform connecting Kansas students, employers, colleges, and local workforce boards around paid internships that earn academic credit.

The program launches city by city: the administrator secures a local workforce board, then a college, then opens the market to students and local businesses. The board's $20/hour wage reimbursement is what makes it work — and the pause while a student waits on their board eligibility interview is the gap this platform exists to close.

**Status: mockup with real foundations.** The UI is a demo running on seeded fixtures, but it reads through the same domain layer and repository contracts a production build would use.

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # domain layer unit tests
```

## Start here

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
| Scope | College-level credit only | High school modeled in the schema but dark |
| Who participates | Degree-seeking students only | No adult job seekers or unaffiliated career-changers |
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
src/services/    Write path (executeTransition), input validation,
                 notification dispatch.
src/lib/         Derived views (what's stuck, market health, funnel) so no
                 portal computes its own answer.
src/components/  Component library, rendered at /design.
src/app/         Route segments per portal over a shared shell.
```

Properties worth knowing:

- **No database.** Everything runs off seeded fixtures. The Postgres schema and its scoping SQL are written and tested; connecting is an adapter swap.
- **One write path.** `executeTransition` is the only way state changes: guard, persist, audit, and notify in a single transaction, with optimistic concurrency.
- **Sign-on is simulated, sessions are not.** An httpOnly cookie resolves to a membership, which carries the role and market every read is scoped by. Only the credential check is fake.
- **Portals render buttons from `availableTransitions`**, so permission logic cannot drift across five surfaces.
- **Authorization is re-checked on the server.** Server Actions accept direct POSTs, so a button being absent from a page proves nothing.

Assumptions standing in for unanswered questions are marked inline in the UI with the question number they resolve, and tracked in the user story doc.
