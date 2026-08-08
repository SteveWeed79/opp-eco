# Opportunity Ecosystem

A workforce-development platform connecting Kansas students, employers, education institutions, and state workforce agencies around paid internships that earn academic credit.

**Status: pre-implementation.** We are settling the domain model before writing application code.

## Start here

- [`docs/user-story.md`](docs/user-story.md) — the end-to-end lifecycle across all five actors, with open questions

## Decisions made so far

| Decision | Choice | Notes |
|---|---|---|
| Database | Postgres | Relational domain, cross-entity transactions, row-level tenancy |
| Primary customer | The platform administrator | Admin console is the product; the other portals feed it |
| Minors (under 18) | Model now, launch college-first | Guardian consent and PII disclosure gating built into the foundation |
| Payments | Out of scope | No payment flows in the mockup |
| Current phase | Pitch / stakeholder demo | Polished clickable flow over a real domain layer |

## Architecture intent

The five portals are five views onto **one workflow state machine**, not five independent applications. The domain layer — entities, guarded state transitions, and the permission matrix — is built first with no UI or database dependency, so portals become filtered queries over a single source of truth.
