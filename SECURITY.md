# Security

## Reporting a vulnerability

Email **security@opportunityecosystem.example** with what you found, how to
reproduce it, and what you think the impact is. We aim to acknowledge within
two business days.

Please do not open a public issue for a security problem, and please do not
test against live data or other people's accounts.

## Scope

This repository currently runs as a **demonstration prototype**. It has no
database, no real authentication, and every organisation, student, and figure
in it is fictional. Findings against the demo are still welcome — the code is
intended to become the real system.

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
