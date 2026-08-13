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

The initial release focuses on **internships and work-based learning that carry
college-level credit** — common enough to prove the model, complex enough to
test it. They involve every participant, real money, and academic credit.

Note what that scope is defined by: **the credit, not the school.** A high
school student enrolled in dual or concurrent credit is earning college credit,
and is in scope for the same reason a college sophomore is. The distinction the
platform cares about is which institution grants the credit, which it already
models.

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

**What is not yet modelled is the high school itself.** The credit path already
works for a dual-enrolled student, because the credit-granting college is the
institution the model tracks. What is missing is the school the student
*attends* — and with it, the things that follow from a student being a minor:
whose consent applies to which record, and the hour and occupation limits that
govern paid work under 18.

Those are real rules rather than a configuration flag, and they are the reason
secondary follows rather than ships alongside. Getting them wrong is worse than
arriving later. Stated plainly here because a district will ask, and the useful
answer is that we know what the work is.

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
| Scope is defined by credit, not school | True of the concept; the model has no way to record that a student attends a high school. `organization_kind` is `('business','college','board')` and `Student` carries only a `collegeId`. |
| Minor status governs consent and hours | Not modelled. Nothing distinguishes a dual-enrolled sixteen-year-old from a college sophomore, so nothing can decline a placement it should. |
| Measures transitions into employment | Not modelled. The lifecycle currently ends at credit granted or closed. |
| Employers surfaced as a queue for colleges | Built and visible; the actions on it are not yet wired. |
| Committed-versus-unspent allocation | Built — the board portal tracks it against a finite program year. |
| Clearance per applicant per job | Built, and enforced by the state machine. |

See [`user-story.md`](user-story.md) for the lifecycle this describes and the
open questions still outstanding.
