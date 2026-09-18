# Security

## Reporting a vulnerability

Email **security@careerconnectedlearningnetwork.com** with what you found, how
to reproduce it, and what you think the impact is. We aim to acknowledge within
two business days.

<!--
  This address was `security@opportunityecosystem.example` — a domain RFC 2606
  reserves so that nothing can be delivered to it. A reporting address that
  silently discards mail is worse than none, because somebody who found
  something believes they told us. Confirm this mailbox exists and routes to a
  person before relying on it.
-->


Please do not open a public issue for a security problem, and please do not
test against live data or other people's accounts.

## Scope

This repository is **the real system**, and it is also its own demonstration.
That sentence used to read "a demonstration prototype… no database, no real
authentication", and every clause of it has stopped being true:

- **It has a database.** PostgreSQL, on Neon in deployment, behind a store that
  refuses writes by default and a scoping layer applied in one place.
- **It has real authentication.** Passwords are scrypt at OWASP's 2¹⁷ baseline,
  one-time codes are stored as SHA-256 and never enter the notification outbox,
  administrators can enrol a second factor, and sessions are server-side tokens
  that can be revoked.
- **Not everything in it is fictional any more.** The prototype under `/demo`
  runs on invented organizations, and markets carry `is_demo_data` saying so.
  Anything without that flag is somebody's actual programme.

Findings against the demonstration are still welcome and are the same code
path. Findings that cross the line between the two — anything letting invented
rows pass as real, or real rows reach a demonstration surface — are the most
serious thing you can send us.

## What we care about most

Given what this platform is designed to hold, these are the findings we would
treat as most serious:

- **Cross-tenant access** — any path by which one market, college, employer, or
  board can read or change another's records
- **Authorization bypass on the write path** — anything that moves an
  application without going through the state machine's guards
- **PII disclosure** — a student's contact details reaching an employer before
  the placement stage that permits it
- **Audit tampering** — any way to modify or delete an audit record
- **Credential handling** — a one-time code or reset code reaching anywhere it
  is persisted and rendered, a password hash readable through any surface, or a
  temporary credential that survives being used
- **The demonstration boundary** — a real learner's record appearing on a
  demonstration surface, or invented figures counted into a real market's
  totals. `markets.is_demo_data` is the only thing separating them, and nothing
  in the application is permitted to write it

## Design commitments

Two rules are architectural rather than incidental, and we would consider it a
serious finding if either were violated:

- The platform stores the workforce board's **eligibility determination**, never
  the evidence behind it — no income verification, disability status, justice
  involvement, or veteran status.
- The platform **never stores a Social Security Number**, in any field, for any
  purpose.

See [`docs/security-and-data.md`](docs/security-and-data.md) for the regimes
that drive these and the rest of the data-minimisation rules.
