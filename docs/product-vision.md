# Product Vision

**Status:** Draft for review.
**Audience:** Kansas workforce boards, colleges, and high schools.
**Purpose:** State what the platform is for, before anyone reads what it does.

`[Platform]` is a deliberate placeholder — the name is not settled, and the
code carries the same placeholder so a decision costs one edit. See
[`src/brand.ts`](../src/brand.ts).

---

An employer has work worth doing but no idea how to scope it into something a
student could take on, or which students are nearby. A student needs experience
and doesn't know which local employers would have them. They are in the same
county and have no reason to ever find each other.

The college knows both. The workforce board has funding that would make it
viable. The administrator can see across all of it. None of them has an
instrument for turning that into a placement — so the connection that should
have been obvious never forms.

And when it does form, it can still die waiting. A student and employer agree;
then nobody tells the student that the board must determine their eligibility
before the placement can be funded, or that they are the one who has to book
it. Weeks pass, the term starts, and an opportunity everyone wanted falls
through — not because anyone said no, but because the parties who each held one
piece of it never connected. The board's allocation stays committed against a
placement that never happens.

**[Platform] exists to close both gaps.** It is the connective infrastructure
between the resources, organizations, opportunities, and people that already
exist but operate separately.

It is not a job board, and not an internship-management system. Those manage
opportunities that already exist. This one helps bring them into existence, and
then keeps them alive.

## Who it serves first

The platform is built for the **program administrator** and the **education
partners** who operate alongside them — the people responsible for making a
local career-connected learning ecosystem function across organizations that do
not report to each other.

Their role is active, not supervisory. The college verifies students, helps
employers scope work into credit-bearing opportunities, and grants the credit at
the end. The administrator opens markets, watches where placements stall, and
intervenes. Both are brokers, and neither currently has a tool built for
brokering.

For a **workforce board**, the platform makes committed funding visible and
recoverable: which placements a determination has been made for, which have
started, which are quietly dying, and what is still unspent in the program year.
Because clearance is per applicant per job rather than a portable credential,
interview volume tracks applications — and that volume becomes something you can
see coming instead of something that arrives.

For a **college**, it addresses the supply problem behind every
internship-for-credit requirement. Employers who want to host but don't know how
to write the opportunity are surfaced as a queue to work, not left to figure it
out alone. Verification and credit decisions live in the same place as the work
they attach to.

Students and employers each get a portal suited to their part. Every portal also
feeds the administrator's view, so oversight is a product of the system running
rather than a reporting exercise laid on top of it.

## What it starts with, and what it is built to hold

The initial release focuses on **postsecondary internships and work-based
learning** — common enough to prove the model, complex enough to test it. They
involve every participant, real money, and academic credit.

The architecture is deliberately not built around that one experience type. It
is designed to support career-connected learning in its several forms:

- **Sustained placements** — internships, apprenticeships, work-study, career
  and technical education, summer youth programming
- **Project-based work** — micro-internships, employer-sponsored projects,
  classroom-industry collaborations, service-learning
- **Exploratory and relational experiences** — job shadows, mentorships, career
  exploration

These differ along a handful of dimensions the platform models directly: whether
the experience is paid and how, whether it carries academic credit, whether it
requires funding clearance, and what the student produces. New forms of
career-connected learning are configurations of those dimensions rather than new
systems.

**Secondary is not yet modelled, and extending to it is real work rather than a
setting.** High school work-based learning runs on different consent,
supervision, liability, and credit rules; the current data model assumes a
postsecondary student attached to a college. Saying so plainly is more useful
than implying a switch that does not exist — and the dimensional approach above
is what keeps that extension additive rather than a second system.

The outcome all of them point toward — **a student moving into part-time or
full-time employment** — is what the platform measures, not another experience
to be managed.

Long term, [Platform] should connect people, organizations, funding, education,
and employers across the full education-to-career continuum.

---

## Where this does not yet match the build

Recorded so the vision is not quietly read as a description of what exists.

| Claim | Reality |
|---|---|
| Supports several experience forms | Two are modelled — standard and micro. `Track` is a two-value enum, not the dimensional model described above. |
| Extending to secondary is additive | Not modelled at all. `organization_kind` is `('business','college','board')`, `Student` requires a `collegeId`, and a constraint pins `hours_per_credit` to colleges. Secondary needs schema work, not configuration. |
| Measures transitions into employment | Not modelled. The lifecycle currently ends at credit granted or closed. |
| Employers surfaced as a queue for colleges | Built and visible; the actions on it are not yet wired. |
| Committed-versus-unspent allocation | Built — the board portal tracks it against a finite program year. |
| Clearance per applicant per job | Built, and enforced by the state machine. |

See [`user-story.md`](user-story.md) for the lifecycle this describes and the
open questions still outstanding.
