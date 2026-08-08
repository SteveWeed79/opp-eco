# Opportunity Ecosystem

A workforce-development platform connecting Kansas students, employers, colleges, and local workforce boards around paid internships that earn academic credit.

The program launches city by city: the administrator secures a local workforce board, then a college, then opens the market to students and local businesses. The board's $20/hour wage reimbursement is what makes it work — and the pause while a student waits on their board eligibility interview is the gap this platform exists to close.

**Status: pre-implementation.** We are settling the domain model before writing application code.

## Start here

- [`docs/user-story.md`](docs/user-story.md) — the end-to-end lifecycle across all five actors, with open questions

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
| Workforce clearance | Once per applicant | Clearance travels with the student, not the application |
| Payments | Out of scope | No payment flows in the mockup |
| Current phase | Pitch / stakeholder demo | Polished clickable flow over a real domain layer |

## Architecture intent

The five portals are five views onto **one workflow state machine**, not five independent applications. The domain layer — entities, guarded state transitions, and the permission matrix — is built first with no UI or database dependency, so portals become filtered queries over a single source of truth.
