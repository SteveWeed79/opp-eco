# CCLN — Career Connected Learning Network

A workforce-development platform connecting Kansas students, employers, colleges, and local workforce boards around paid internships that earn academic credit.

The program launches city by city: the administrator secures a local workforce board, then a college, then opens the market to students and local businesses. The board's $20/hour wage reimbursement is what makes it work — and the pause while a student waits on their board eligibility interview is the gap this platform exists to close.

**Status: mockup with real foundations.** The UI is a demo running on seeded fixtures, but it reads through the same domain layer and repository contracts a production build would use.

## Two sites, one deployment

`/` is the **venture**: what this organization is, who it serves, what a partnership includes, and what has actually been tested. Indexed, and every figure on it is real.

`/demo` is the **prototype**: five portals over one workflow, running on invented organizations, carrying a demonstration banner and `noindex` on every page.

They used to be the same page, and that page had to be honest and impressive at once. It opened with a program pitch and four statistics computed from seeded fixtures, under a black bar explaining that every figure above it was fictional — so a reader had to hold two contradictory frames simultaneously, and a funder given the address had nowhere to land. Splitting them is what lets the demonstration labelling stay loud without it being the first thing anybody reads.

Every path lives in [`src/routes.ts`](src/routes.ts), because the portal paths are also the redirect target after sign-on, the paths revalidated after a write, the links in every notification email, and the partner-theming check. A copy at any one of those call sites is a copy that can disagree with the rest — which is exactly what happened during the move, twice, and is why `front-door.spec.ts` asserts the split rather than trusting it.

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
- [`docs/vision-alignment-review.md`](docs/vision-alignment-review.md) — where the site and the Patterson Fellows 2026 application describe different ventures, and what closing each gap looks like

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
| Mentorship | A separate entity, not a third track | Unpaid, uncredited, never reimbursed — it is the absence of the placement machinery, so inheriting that machinery would be wrong |
| Workforce clearance | Per applicant, per job | Not portable — every standard application gets its own board interview |
| Demo data | Entirely fictional organizations | Real Kansas cities and counties; no institution, board, or business is real |
| Seeded markets | The four-community proving ground | Pittsburg, Emporia, and Hays — three university towns — plus Beloit, deliberately a tenth their size. Three university markets can prove the model works next to a university; they cannot show whether it travels |
| Funding | Many sources, one placement | A board's wage subsidy, a foundation's grant against the cost of internship credit, a college's fee waiver, an employer's contribution. A market carries no money of its own — every figure is the balance of a fund |
| Allocations | Expected to change | A supplemental award or a rescission is ordinary program administration, so adjusting one is an audited write with a reason, not a fixture edit |
| Payments | Out of scope | The platform tracks funding obligations but moves no money |
| Current phase | Pitch / stakeholder demo | Polished clickable flow over a real domain layer |

## Architecture

The five portals are five views onto **one workflow state machine**, not five independent applications.

```
src/domain/      Pure TypeScript. Entities, guarded transitions, workflow
                 profiles per track, credit accumulation, match scoring,
                 PII disclosure, funding sources and the ledger against them,
                 and the follow-up outcome — the one record here that is an
                 observation rather than a state machine. No UI, no database.
src/auth/        Session resolution behind a provider interface. Replacing
                 simulated sign-on touches this and nothing else.
src/data/        Repository contracts, two implementations behind them — the
                 in-memory fixtures and Postgres — and the Store/UnitOfWork
                 for writes. One environment variable picks which.
src/services/    Write paths (executeTransition for existing records,
                 creation for new ones), input validation, notification
                 dispatch and the outbox that records it.
src/lib/         Derived views (what's stuck, market health, funnel) so no
                 portal computes its own answer.
src/components/  Component library, rendered at /demo/design.
src/routes.ts    Every path, in one place. The `/demo` prefix, the portal
                 paths, and which surface a pathname belongs to.
src/app/         `/` and the venture pages; `/demo/*` per portal. One shell
                 picks the chrome from the route.
```

Properties worth knowing:

- **Two data layers, one contract.** With `DATABASE_URL` unset everything runs off the seeded fixtures — that is the demo, the unit suite, and a zero-configuration checkout. Set it and the same screens read Postgres, through the same repository interfaces, with writes refused unless `DATABASE_READ_ONLY=false`. A CI job applies the schema, seeds it, and asserts the two layers return the same records for every accessor and every role; see [Running on Postgres](#running-on-postgres).
- **One write path.** `executeTransition` is the only way state changes: guard, persist, audit, and notify in a single transaction, with optimistic concurrency.
- **Sign-on is simulated, sessions are not.** An httpOnly cookie resolves to a membership, which carries the role and market every read is scoped by. Only the credential check is fake.
- **Portals render buttons from `availableTransitions`**, so permission logic cannot drift across five surfaces. Adding a transition to the table makes its button appear everywhere it applies without editing a page.
- **Authorization is re-checked on the server.** Server Actions accept direct POSTs, so a button being absent from a page proves nothing.
- **One action per portal, each with its role hardcoded.** Not one generic action taking a portal name — a caller who supplies their own role supplies their own authorization. The client names a target status and never a patch; anything a transition writes is derived server-side.
- **Notifications are queued inside the transaction and sent after it commits.** A send that fails after a commit is retryable; one that succeeds before a rollback has told someone about work that never happened. The queue is part of the data layer — an array on the fixtures, `notification_outbox` on Postgres — and the dispatcher drains whichever one it was handed. `/admin/outbox` shows what was delivered, queued, and undelivered — the audit log says what changed, the outbox says whether anyone was told.
- **Who hears about what lives in one table.** `notification-policy.ts` maps each status an application reaches to the parties told and what each is told; `templates.ts` holds the wording. A transition notifies the right people without its call site listing them, which is what stops a lifecycle having messages for the interesting steps and silence for the rest.
- **A portal is named zones, not a stack of cards.** Every page was a flat run of identical `Card`s, so reading order carried no rank — a queue blocking a placement, a reference table, and a settings panel touched once a year all looked the same. Two things followed, and both were live: anything appended to the end became invisible, and the college's brand picker read exactly like a queue. `PageSection` groups a page into two to four named zones, and its `settings` tone recesses configuration behind a rule, because a page that gives equal weight to "four students are waiting on you" and "pick a brand colour" has not decided what it is for.

## Opportunities have a URL

`/demo/opportunities/[id]` is the full posting: the description, the skills it matches on, the terms, and whether the hours clear the college's credit threshold.

It exists because **the description had nowhere to be read.** A posting cannot be published without one — the college's publish guard refuses an empty description — and yet the only surfaces that rendered it were the employer's own drafts and the college's drafting queue. Students, the people it is written for, were asked to apply from a title and a wage.

A page rather than an expander, because the realistic path into this program is an advisor sending a student a link, and there was no link to send.

**Who can open what** is not the same for every role, and it is decided on the page rather than delegated to `postings.find`:

| | Published | Draft / in review |
|---|---|---|
| Student, board | Yes | **404** — same answer as an id that does not exist |
| Employer | Yes, including competitors' | Their own only |
| College, admin | Yes | Yes |

That distinction is load-bearing. `postings.find` narrows by organization for `business` and by *market* for everyone else — correct for the queues it was written for, and too wide here: it would have let a student open an employer's half-written draft by guessing an id. Nothing had exposed it before, because until this page there was no way to address a posting by id at all. An e2e test asserts a real draft and a nonexistent id return the same status, so the URL cannot become an oracle for what an employer is drafting.

## The five state machines

Still five, and `Outcome` is deliberately not a sixth — see [Outcomes](#outcomes).

Five things have a status and rules about who may change it: an **application**, a **student's** enrolment standing, a **posting**, an **organization's** vetting, and an employer's **mentorship offer**. They share one engine (`domain/machine.ts`) that resolves every move the same way — market isolation, ownership, does the transition exist, is the role permitted, does the guard pass, and may an administrator override it (role and guard yes, market isolation never, and never without a reason).

| Machine | Owned by | Gates |
|---|---|---|
| Application | all five portals | the placement itself |
| Student | the college | whether a student may apply at all |
| Posting | the college, with the employer's half | what students can see |
| Organization | the administrator alone | whether anything can transact |
| Mentorship offer | the employer alone | whether they are currently available |

The application machine was the only one modelled for a long time, and that left two claims in the interface with nothing behind them:

- the admin console said *"nothing transacts until an organization is approved"* — a business at `applied` could post, take candidates, and approve hours a board would reimburse;
- the college portal said *"students cannot apply until verified"* — applying worked regardless.

Both were missing for the same reason. The status existed and the queue rendered it, but nothing could move it, so nothing could depend on it either. `canApply` and `canTransact` are now the single definitions, checked in `creation.ts` where applications and postings are made.

**An administrator sees moves they would have to override**, and the refusal names the guard rather than only asking for a reason — on an admin-only machine like vetting, the administrator is the only caller a guard can ever refuse, so without that they are asked to justify a decision the product declined to describe.

## Mentorship

The three ways of taking part that came first all end in a transaction: a standard internship is reimbursed, a micro project is invoiced, both are examined for credit. Every one of them asks an employer to supervise somebody for weeks. In a small market the common answer is not no, it is *not this year* — and a platform whose only reply to that is an empty page has lost an employer who was willing to help.

So an employer can also offer **time**: a portfolio review, a job shadow, a session with a class, or an ongoing one-to-one. The formats are named rather than free text, because "we'd be happy to mentor students" is a sentiment a college cannot make an introduction out of, and because naming them sets the size of the ask — an employer who reads only "ongoing one-to-one" declines all four.

**It is modelled as the absence of everything else.** No wage, no hour cap, no credit hours, no timesheet, no application. That is the argument for a separate entity rather than a third `Track`: a track is a shape of work an application flows through, and clearance, funding, hours, and credit are all meaningless here — a mentorship pretending to be a posting would inherit the lot and have to switch it off one guard at a time.

Two consequences worth stating plainly:

- **No college review.** A posting waits at `pending_review` because review is what makes it credit-bearing — the college is underwriting an academic claim. A mentorship carries no credit, no wage, and no public money, so there is nothing to underwrite, and a queue in front of the one offer an employer makes on impulse would only lose it. The college is still *told*, because it is the party that makes the introduction.
- **Vetting still applies, and does more work here.** Mentorship puts an adult in front of a student with no supervisor, no timesheet, and no board interview in between. Every check that surrounds a placement is absent, which leaves "is this employer who they say they are" carrying the whole load — so `canTransact` gates creating an offer exactly as it gates posting a job.

### The introduction

**The college or an administrator introduces a student; the student does not ask and the employer does not accept.** That is the same argument as vetting, applied to the other side: with nothing standing between an adult and a student on this form, the first contact runs through the party that knows both. A student requesting directly would put an unvetted first contact in exactly the place this model is most exposed, and would hand employers a second inbox to work.

For a long time the introduction was the thing that *didn't* happen here — the college's mentor list was visible and inert, and the pairing lived in somebody's email. Two things were lost with it. An employer declaring "up to two students at once" was declaring a number nothing could check, and a mentorship that did happen counted toward nothing.

So an introduction is a record. A live one spends one of the mentor's declared places; closing it — *it happened*, or *it did not* — gives the place back, which is what stops a year of successful mentorships silently draining an employer's capacity to zero. Closing requires a note from whoever records it: "it did not happen" with no reason tells the college nothing about whether to try that mentor again, and "it happened" with no reason is the only evidence this platform will ever hold that a mentorship took place.

Who may do what follows from that. The employer normally closes an introduction, being the only party who knows whether the student turned up; the college and the administrator can too, because one nobody ever closes holds a mentor's place open forever. Only verified students can be introduced. The board sees none of it — it reimburses placements, and a mentorship carries no wage, no credit and no public money, so who was introduced to whom is not its business.

`paused` exists so that a busy quarter is not a resignation. An offer whose only exit was `withdrawn` would take an employer off the mentor list permanently the first time they were short-handed, and a paused offer disappears from the student's list in the same request it is paused — an employer still listed after saying they could not take anyone is fielding introductions they just declined.

## Funding

**A market carries no money of its own.** It used to: `subsidyBudget` and
`subsidyRatePerHour` sat on the market record, and that was the entire funding
model — one workforce board, one allocation, one hourly rate. That is the
mechanic the Southeast Kansas pilot runs on, and it is not the thing the venture
sells. What it sells is **funding coordination**, and the second, third and
fourth source were not expressible.

The concrete cost of that: the 177-student survey's top barrier is the tuition a
student pays to *receive credit* for work the board is already subsidising. The
nonprofit arm exists partly to pay it. There was nowhere to record either the
cost or the grant that covered it.

So a figure now lives on a `FundingSource` and nowhere else:

| Sponsor | Purpose | Seeded example |
|---|---|---|
| Workforce board | Wage subsidy | $240,000 at $20/hour |
| Foundation | Cost of internship credit | $18,000 |
| College | Cost of internship credit | $9,000 fee waiver |
| Foundation | Transportation | $6,000 |

Kind and purpose are separate axes on purpose. A foundation can pay a wage or a
bus fare and a college can waive a fee or fund a stipend; collapsing them would
mean a new kind of sponsor every time a new cost appeared.

### The numbers are expected to move

This is the part that shaped the design. An allocation is not a constant that
happens to be stored — a supplemental award arrives, a rescission takes some
back, a board revises its rate between cohorts. While the figure was a fixture
on the market it could only change by a redeploy, which meant in practice it
never changed and every screen quoted a number nobody had revisited.

Adjusting one is now a write with a **required reason**, landing in the audit log
beside the old and new figures. "The number in the database is different now" is
not an explanation, and an allocation that moved is the one figure a funder will
certainly ask about.

**Reducing an allocation below what is already committed is allowed.** That is
the decision worth arguing. A rescission is a real thing that happens to public
money, and a board that has committed $180,000 and just had its award cut to
$150,000 is overcommitted in fact — refusing the edit would leave the software
showing a figure the board knows is wrong. It is the same argument as approved
hours exceeding an authorized cap: naming it is the only honest option, and the
console leads with it.

A *new commitment* that would not fit is refused, and the asymmetry is
deliberate. An allocation moving is news arriving from outside and the
platform's job is to show it; a commitment is the platform's own act, and
knowingly promising money a fund does not hold is how a student is told they
have a grant that will not arrive.

### The ledger

A `FundingCommitment` is one draw against one fund, and **every balance
anywhere is derived from sources and commitments**. Nothing caches a total: a
stored total is a number that can disagree with the ledger, and a funder asking
where their money went is the worst possible audience for two answers.

Commitments carry their own rate, copied at authorization rather than read
through the fund. A board moving next year's cohort from $20 to $18 must not
retroactively rewrite what it already promised at $20.

Three statuses, and the distinction the old model could not make:

- **authorized** — promised, not yet paid.
- **disbursed** — the placement ran and finished, so the money was *spent*.
- **released** — it ended before anyone started, so the money returns.

Settlement happens inside the same transaction as the state change that caused
it (`settlementFor`), because five portals can move an application into a
terminal status and a rule living in one of them is a rule the other four break.
A released row is kept rather than deleted — "what did we commit and not spend"
is a question a board asks at the end of a program year, and a missing row
cannot answer it.

Before this, `marketRemainingBudget` simply stopped counting any terminal
application, which silently treated a completed, fully reimbursed placement and
an application withdrawn on day one as the same event. For a board reconciling a
program year they are opposites.

### Who may move money, and who may see it

Spending is decided by **ownership, not role**: the organization that sponsors a
fund, plus the administrator. "The board may commit" stops being true the moment
a market has two boards, and "the college may commit" would let one college draw
on another institution's scholarship.

Reading is deliberately wide. Every actor in a market sees every fund in it — a
student working out whether they can afford the credit and an employer working
out whether hosting is viable are asking the same question, and a funding model
visible only to its sponsor would reproduce the gap this venture exists to close.
What is narrowed is the *commitments*: an employer sees draws against placements
it hosts, a student sees their own.

The one new organization kind, `nonprofit`, exists because a fund needs a
sponsor. The wider network the vision names — K-12 districts, training
providers, economic development offices — is still absent: each needs its own
answer to what vetting means for it, and adding kinds nothing uses would be a
migration that buys a longer enum.

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

## Outcomes

Every other record here measures whether a *placement* worked — the hours were
approved, the credit was granted, the board's money bought what it was committed
to. None of them measures whether the venture did. The claim this platform makes
to a funder is narrower and harder: that a learner who takes part is more likely
to end up **working in their own region**. The lifecycle ended at credit granted,
so there was nowhere to put the answer either way.

An `Outcome` is one follow-up observation about one learner, and optionally about
the experience it followed. Six answers:

| | Counts as |
|---|---|
| Hired by the host employer | Regional employment |
| Employed in the region | Regional employment |
| Employed outside the region | Employment, not retention |
| Continued in education | Positive, not employment |
| Entered training or an apprenticeship | Positive, not employment |
| Still looking | A recorded result |

**Employed in the region and employed elsewhere are separate values, not one
"employed".** That distinction is the entire argument the venture rests on: a
programme that reliably produces graduates who leave is a talent pipeline out of
the county, and a board funding it should be able to see that. Folding them
together would give a number that always looks good.

**It is not a state machine, and that is the design.** There is no status, no
version, and no update path — an outcome is an *observation*, so a learner
followed up again six months later gets a second row. Nothing supersedes anything,
because the follow-up history is the evidence being offered. `summarizeOutcomes`
counts one observation per learner, the most recent, so a diligent officer cannot
inflate the denominator by doing their job.

### Absence is not a result

`still_seeking` is a recorded answer. A learner nobody has asked has **no row at
all**, and the two are reported separately: the console shows regional employment
over the learners actually measured, beside the count of finished placements
nobody has followed up on. Rating over everyone who exited would make an unworked
queue read as a programme that fails to place people, and a rate of zero over
nothing measured would be worse — so the rate is blank until there is something
to compute it from.

The seed ships with the queue still half-worked, and with a learner who took a
job in Kansas City, for the same reason the seeded college's brand colours
collide twice: a measure that only ever reports good news on its own fixtures has
not been tested against anything.

### Who does it, and who sees it

The college records them, because follow-up is local-operator work and it holds
the relationship that makes the call get answered; an administrator can too, for
the same reason they can do anything else here. The learner and the employer are
deliberately absent and are the open question (Q23) — an employer is the only
party that actually knows it made a hire, and a self-report is the commonest
source in real workforce reporting, but each needs a rule about what it may claim.

**The board reads the counts and never the free text.** Its obligation is how
many were employed and how many stayed, which is exactly what the kind says; the
sentence naming a learner's new employer is a fact about someone's life rather
than a performance measure. That is the timesheet redaction applied at the other
end of the lifecycle, and it is in the repository rather than the component.

An employer reads **none of them**, which is the case that shaped the query
layer. It can read the applications against its own postings and no outcomes at
all, so a follow-up queue built by subtracting one list from the other would have
shown every placement it hosted as never followed up — work already done,
presented as outstanding, with no way to discover otherwise. `canReadOutcomes`
exists so a derived view can tell "no outcome exists" from "you may not see one",
and `outcomeScope` is tested against it so the two cannot drift.

## What leaves the building

Every other privacy control here decides what a *signed-in* caller may read. A
notification is different in kind: it leaves the system entirely, over a channel
nobody controls, into an inbox that will be forwarded, searched, backed up, and
eventually breached by somebody else.

DOL's TEGL 39-11 — which reaches anyone handling participant PII in a
WIOA-funded program, and the $20/hour reimbursement almost certainly is WIOA
Title I money — says never to email unencrypted sensitive PII to anyone. So:

**No message names the learner it is about.** Subject lines carry a record
reference (`APP-12`) instead. That reverses a rule this codebase used to hold
deliberately — *"a subject line without a name is unsortable"* — and the
replacement sorts just as well while identifying nobody. A subject line is the
least protected part of an email: logged by every relay, shown on a lock screen,
quoted whole in every reply.

The templates were rewritten, and a denylist strips participant keys at
`enqueueNotification` as a backstop — at the `UnitOfWork` rather than the
renderer, because the Postgres queue persists the payload to a table and a guard
at render time would clean the email while leaving the name in a database.
`notification-privacy.test.ts` renders every template against every seeded
learner and fails on any leak.

**Every employer-facing message carries the FERPA redisclosure notice.** An
employer forwarding a candidate to a colleague at another company has created a
problem that traces back to this product, so the product carries the warning.

Names of people acting professionally stay — a board officer on an interview
slot, a mentor, an employer contact. Those are role-functional identities, and a
student booking a call should know who they are meeting.

## Consent

Once a college hands this platform a roster, a verification or a credit award,
those are education records. **Consent is a property of the record's source
institution** — not of the learner, and not of the platform. A college's consent
does not authorise a high school's records about the same person, and a
dual-credit placement can generate both.

So a consent names the institution it covers, and it has a visible consequence
rather than being paperwork: an employer's step up from an abbreviated name to
contact details requires **both** the placement stage and education-record
consent on file. Withdraw it and the employer's view narrows on the next read.

**Who signed is recorded, not computed.** FERPA rights transfer to the learner
at 18 *or* on postsecondary enrolment at any age — so a dual-enrolled
sixteen-year-old consents for themselves on the college's records while their
parent still holds the school's. Deriving that needs the school a learner
*attends*, which the model does not have, and a registrar's settled local answer,
which no column can supply.

The seed ships one verified learner with no consent on file, so the gate is
visible on the data the demo runs on.

## Retention

Kansas requires deleting a learner's personal information once it is no longer
required for the purpose collected, and with dual-credit high schoolers in scope
that binds directly. **A record with no deletion date is a record kept forever**,
so the schedule is decided before there is real data:

| Record | Kept | From |
|---|---|---|
| Uploaded files | 1 year | the placement ending |
| Learner identity | 3 years | last participation |
| Applications and placements | 5 years | reaching a terminal status |
| Audit log | 7 years | the entry being written |

Two decisions worth arguing with:

**Purging anonymises rather than deletes.** The rows stay; the identifiers go. A
programme has accountability obligations that outlive any individual's privacy
interest, and deleting a learner would silently restate every historical figure a
board was already reported. What survives is what aggregates are *by* — which is
also why this is anonymisation for the purpose of not holding contact details and
not a claim of k-anonymity: in a market the size of Beloit, one programme in one
year may be one person.

**The clock runs from last participation, not from record creation**, and an
active learner is never purged however old their record is — the rule is "no
longer required for the purpose collected", and a live application is that
purpose.

There is no unattended sweep, deliberately. Anonymisation is irreversible and the
first automatic run would hit every record at once; a person pressing a button
against a computed list is how you find out the schedule is wrong while that is
still cheap.

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

## Running on Postgres

The app has two data layers behind one set of repository contracts, and
`DATABASE_URL` is the whole switch.

| `DATABASE_URL` | Reads | Writes |
|---|---|---|
| unset | Seeded fixtures in the server process | Land in the fixture arrays |
| set | Postgres | **Refused**, unless `DATABASE_READ_ONLY=false` |

Read-only is the default whenever a database is configured, because pointing
the demo at real Postgres and letting anyone who opens it mutate what everyone
else is looking at are different decisions. The seed script bypasses the guard:
loading fixtures is an operator action, not a write the web application makes.

**The driver is chosen from the host, not configured.** A `.neon.tech` URL
opens through Neon's serverless driver over a WebSocket — which is what a
serverless deployment wants and the only thing that reaches Neon. Every other
host opens through `pg` over an ordinary socket, which is the only thing that
reaches a local or self-hosted Postgres. `DATABASE_DRIVER` overrides the
inference for a Neon-compatible proxy that does not carry the hostname.

Locally, against any Postgres you have:

```bash
createdb oppeco
export DATABASE_URL=postgresql://you@localhost:5432/oppeco
npm run db:verify     # prove the connection and report the driver
npm run db:migrate    # apply the schema
npm run db:seed       # load the same fixtures the demo runs on
DATABASE_READ_ONLY=false npm run dev
```

On Neon, use the **direct** connection string for migrations — DDL through a
connection pooler can land on a different session than the one holding the
transaction — and the **pooler** host for the running app.

### Pointing a deployment at it

Four variables, in this order:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | the **pooler** host | A serverless deployment opens a connection per invocation; the direct endpoint runs out of backends on a free tier |
| `DATABASE_READ_ONLY` | leave unset | Refusing writes is the default, and a shared demo is exactly the case it exists for. Set `false` only when the deployment is meant to be mutated |
| `DATABASE_MAX_CONNECTIONS` | leave unset | 10 suits a free tier |
| `EMAIL_REDIRECT_TO` | your own address | Unrelated to the database, and the thing to get wrong once |

Migrate and seed from a terminal against the **direct** host before the first
deploy — `npm run db:migrate && npm run db:seed` — rather than from the running
app, which has no path that applies a schema and should not have one.

A read-only deployment reads Postgres and refuses every write with a sentence
saying so, rather than a dead button: a disabled control is a claim the page
makes and a direct POST ignores, so the refusal lives in the one layer every
write passes through. Nothing is dispatched from the notification queue there
either — claiming a message marks it sent, and a deployment that cannot write
must not mark someone else's messages as sent.

### Proving the two layers agree

Everything in `src/data/postgres` is unit-tested against a recording client,
which proves the statement text and nothing about whether Postgres accepts it.
`src/data/postgres/integration.test.ts` closes that gap: it applies the
migrations, loads the fixtures, and then asserts that every repository
accessor, for every role, returns the same records as the in-memory layer
reading the same fixtures — plus the write path, optimistic concurrency, and
rollback.

```bash
TEST_DATABASE_URL=postgresql://you@localhost:5432/oppeco_test \
  npx vitest run src/data/postgres/integration.test.ts
```

It skips without `TEST_DATABASE_URL`, so a checkout with no database still runs
the whole suite green; CI runs it against a container on every change. **The
database it names is truncated and reseeded** — never point it at one whose
contents matter.

Running the **whole e2e suite against Postgres** is the other half, and worth
doing after any change to the data layer: point `DATABASE_URL` at a seeded
local database, set `DATABASE_READ_ONLY=false`, and run `npm run test:e2e`.
Every flow the demo has passes on either backend.

The first run of that suite found six faults that no amount of TypeScript would
have caught: a `citext` column whose extension was never created, two seeded
foreign keys pointing at users that do not exist, two fixture pairs violating
the app's own one-application-per-posting rule, a verification the schema
refused because the acting user never reached the `UPDATE`, and a market scoped
by `markets.market_id` — a column that table does not have. Parity found two
more in the *other* direction: the in-memory layer let a signed-in student read
every classmate's application and every classmate's student record, which the
SQL layer had always refused.

Driving the browser against Postgres found the two that only a running app
shows. Every notification to an employer, a college or a board was addressed to
an organization — most employers have no user account — and the outbox column
referenced `users`, so the insert failed and took the state change beside it
down. And `outbox.ts` drained the in-memory queue directly, so once that was
fixed the rows landed in `notification_outbox` and were never sent: the audit
log said the board was told, the outbox screen said nothing had been sent, and
both were right. The queue is now a seam on the backend, and the dispatcher
drains whichever one the data layer filled.

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
- **A job description document to download.** Employers often already have one as a PDF, and the opportunity page is where it belongs. The upload pipeline is built but every file in it is scoped to a *student* — `UploadTarget` requires a `studentId` and `canRetrieve` derives access from the student record. A posting's attachment inverts that: it belongs to an organization, and on a published posting it is readable by every student in the market, which is a broader rule than any file has today. That is a deliberate extension of the access model, not a wiring job.
- **Program-year rollover.** A fund carries a `programYear` and nothing rolls it
  over. What happens to an unspent allocation at year end, whether a live
  commitment crosses the boundary with it, and whether the next year's fund is a
  new row or the same one re-allocated are all policy questions a board answers
  differently from a foundation (Q24).
- **A fixed follow-up interval.** Workforce reporting measures employment at set
  quarters after exit — the second and the fourth — and an outcome here is
  recorded whenever somebody asks. The record already separates the date an
  outcome was true as of from the date it was entered, which is what a windowed
  report would need; what is missing is the rule about when a follow-up becomes
  *due* rather than merely possible, and that decides whether the resulting
  figure is comparable to the ones a board already reports (Q23).
- **Editing an approved week.** Correction today runs through rejection: a supervisor sends a week back and the student logs it again. That covers the case before sign-off. Amending a week *after* approval changes a figure a board may already have reimbursed, so it needs a supersede-with-audit-trail rather than an edit, and a rule about who may initiate one.

Assumptions standing in for unanswered questions are marked inline in the UI with the question number they resolve, and tracked in the user story doc.
