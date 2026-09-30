# What is left

Everything known to be missing, half-built, or deliberately deferred, in one
place, as of September 2026.

**Why a list and not `TODO:` comments everywhere.** Before this file the repo
contained zero `TODO` markers, and that was a convention rather than an
oversight: reasoning lives in prose next to the code it concerns, which is why
`retention.ts` explains its own absent scheduler and `0011_second_factor.sql`
explains its own recoverable secret. Scattering fifteen markers would lose the
two things a list gives and a comment cannot — an **order**, so the thing
standing between this and a real market is visible above the thing that merely
annoys, and a **whole**, so the items that are one job seen from four files
read as one job.

So: the reasoning stays where it is, this file carries the ordering and the
ownership, and the handful of sites where the code looks finished and is not
carry a one-line `TODO(Tn)` pointer back here. Each entry below says where it
lives, what is true now, what is missing, and — where it matters — **whose
decision it is**, because several of these are not the code's to make.

Items are numbered for reference and never renumbered; a closed one is struck
through and kept, because "why is there no X" is a question this file should
still answer after X exists.

---

## Before a real learner signs in

### T1 — Businesses have no door

`src/app/register/` (learners only) · `docs/user-story.md`, Phase 2

A learner can register themselves. A business cannot. Phase 2's "a local
business joins the market" is unbuilt, and the administrator's vetting queue is
still fed only by the seed — so on a real market's first day there is nothing in
it and no way to put anything in it.

Mechanically this is the smaller half of the job now that `registerLearner`
exists to copy. The part that is not a copy is **the gate**. A learner is
checked by their address: `addressMatchesOrganization` proves a Verdigris
learner has a Verdigris address, and that single rule is the whole anti-abuse
story for T1's sibling. A business has no institutional address to check
against — `bobsdiner@gmail.com` is a real employer's real address — so the gate
has to be something else, and the candidates are not equivalent:

- **Vetting is the gate.** Let anyone register, land them in the vetting queue
  the administrator already works, and let nothing happen until they are vetted.
  Cheapest, and it moves the cost onto the one desk least able to absorb it.
- **A market invites.** The board or the college creates the organization and
  the business claims it. Matches how these relationships actually begin — a
  board officer knows the employers — and leaves cold inbound with no path.
- **A business claims a posting.** Nothing to claim before the first posting
  exists, so this cannot bootstrap a market.

The first is probably right for a market this size, but it is a decision about
how much unvetted noise an administrator will accept, which is Steve's.

### T2 — A safety report mails everyone, and mails them slowly

`src/services/escalation.ts` · `src/services/notification-policy.ts`

Raising a problem works, and it reaches an administrator. Two things about
*which* administrator and *how fast* are wrong, and they are one fix:

- Administrators are the only cross-market role, so **every administrator on
  the platform** is mailed. At one market that is the right set by accident. At
  ten, a safety report in Pittsburg mails whoever runs Hays.
- **Email is the wrong urgency.** A safety report at two in the morning queues
  in the outbox behind *new applicant* mail and arrives when the outbox next
  drains.

Both want an **escalation contact per market** — a name, an address, and
probably a phone number, set by whoever runs that market. That is an operator's
statement about who is on call, not something to invent in code, so it needs
Steve before it needs a migration. Worth deciding at the same time: whether
`safety` alone gets the out-of-band path, or every kind does.

### T3 — TOTP secrets are stored recoverable

`src/data/postgres/migrations/0011_second_factor.sql` · `src/auth/postgres-store.ts:263`

`user_totp.secret` is base32 plaintext, and the migration says so in its own
header rather than hiding it: TOTP is a shared secret, the server has to compute
the code the phone computes, and there is no hash that would still work. What
follows is that **a dump of that one table is enough to generate second factors
for every administrator on the platform** — the accounts that read every market
and authorise money.

Everything else credential-shaped here is SHA-256. This is the exception, it is
the highest-value row in the schema, and the answer is encryption at rest with
the key outside the database. Not hard; it is listed this high because the
second factor exists specifically to protect the accounts whose compromise is
worst, and an unencrypted shared secret is most of that protection given back.

### T4 — Confirm the contact addresses reach a person

`SECURITY.md:5` · `src/brand.ts:85`

Both point at `steve@swbuild.dev`. `SECURITY.md` already notes that the
`security@` address it used to carry was a reserved example domain, chosen so
nothing could be delivered — the note is there, the follow-through is not. Before
anything is published: confirm that address is monitored, and decide whether a
`security@` on the real domain should front it. A vulnerability report that
bounces is worse than no address at all, because the reporter has already done
their part.

### T5 — Rotate the database credential

Operator action, nothing in the repo

The production database password has been handled by hand rather than through a
secret store, which means it has been somewhere it should not persist. Rotate
it, and while rotating decide where it lives — the environment it is read from
now is fine; the path it took to get there is not repeatable.

---

## Built, but nothing can reach it

These are the cheapest entries on the list and the easiest to miss, because the
model is finished and the tests pass. Only a screen is absent, so nothing fails.

### T6 — A learner cannot attach a resume

`src/services/uploads/validation.ts:69` · `src/components/ui/FileUpload.tsx`

`UPLOAD_PURPOSES.resume` is fully specified — PDF, .docx and legacy .doc, 5 MB,
magic-byte checked — and covered by its own tests, including "rejects an image
on the resume purpose". `uploaded_files.purpose` accepts it. `purgeLearnerIdentity`
already knows to delete it.

**No screen uploads one.** `FileUpload` appears in exactly two places: the
deliverable hand-in, and the design gallery. So the learner's profile is a
programme, a class standing and a skills list, and an employer shortlisting
somebody reads none of the document a learner would actually send.

This is now a wiring job of the same shape as the deliverable file, which is
done and can be copied: attach on the profile rather than per application (one
document, many applications), and let `canRetrieve` decide who sees it — it
already withholds a surname before a placement releases details, and a resume
with a surname on the front is the same question.

### T7 — The standard track produces no written assessment

`src/domain/workflow.ts:210`

The two tracks are backwards, and it is only visible side by side.

On the **micro** track, `Accept deliverable` requires words, the schema refuses
an empty acceptance, and the dialog tells the employer that what they write *is*
the evaluation. A registrar awarding credit reads an assessment.

On the **standard** track — the longer one, the one with a named supervisor, the
one carrying more credit — `Mark placement complete` guards on **quantity
only**: approved hours above zero, no unreviewed weeks. Both guards are good and
neither is an assessment. So the registrar awarding credit for a 180-hour
placement reads a number, and the one awarding credit for a 20-hour project
reads a paragraph from the person who supervised it.

A supervisor evaluation on completion closes it. What it should ask is the
college's call, not the platform's: one required paragraph is the minimum
worth shipping, and anything more structured should come from a registrar who
has had to defend a credit award.

### T8 — The board watches the queue it cannot act on

`src/app/demo/board/page.tsx:322`

*Reached mutual interest but never booked* is the queue the user story argues
matters most — it is where placements die quietly — and **Reach out** beside it
is disabled, with a tooltip saying there is no messaging path and that a nudge
would go through the college, which owns the learner relationship.

That is honest, and it is stated in `docs/user-story.md` as honest. It is also
the party best placed to notice the problem holding the only screen with no
action attached. The narrow fix is to let the board **ask the college to nudge**,
which keeps the college in front of the learner and gives the board something to
press; `outreach.ts` already sends nudges and already records them. The wide fix
is a messaging path between roles, which is a much larger thing and should not
be started to solve this.

### T9 — A minor still cannot be recognised

`src/domain/consent.ts` · `src/data/postgres/migrations/0007_consent.sql`

Consent can be recorded, `parent_guardian` is a grantor, and the college portal
records one. **No date of birth or age exists anywhere in the model**, so
nothing can require consent before an application, gate a field on it, or cap
hours by it.

The platform can therefore say a guardian consented and cannot say who needed
one. With dual-credit high schoolers in scope that is the gap that matters, and
it is deliberately still open because collecting a date of birth is itself a
decision with consequences — it is the most sensitive field anyone has proposed
adding, it lands under the retention schedule the moment it exists, and "we need
it to protect minors" is the reasoning behind most of the personal data nobody
should have collected. An age band, or a single `isMinor` flag set by the
college at verification, may be enough to gate on and is far less to hold.
Steve's call, and worth making before a college asks.

---

## The shape of the console

### T10 — Settings and Access are wedged into the operations page

`src/app/demo/admin/page.tsx` (1,402 lines) · `src/app/demo/college/page.tsx`

The administrator's console carries queues and configuration on one page:
second-factor enrolment, region boundaries, the retention schedule, and the
access panel sit alongside *Reported to you* and *What's stuck*. The college's
page does the same with an inline `INSTITUTION SETTINGS` block.

The agreed shape, which is not yet built:

- **Configuration goes behind a settings route.** Region boundaries and the
  retention schedule are set once and read rarely; they cost attention every
  time the page loads and they push the two queues that are actually the job
  further down it.
- **Access gets its own operations page, not a gear icon.** Adding a person and
  moving a work address are *reactive* work — somebody is waiting, usually
  today. Filing that under settings puts an urgent task behind a configuration
  menu.
- **The board's slot publishing stays where it is.** Publishing interview slots
  is the board's core loop, not configuration, and Phase 4 works end to end
  partly because it is on the page.

This is a refactor with no behaviour change, which makes it easy to keep
postponing and easy to do badly. The ordering above is the point of it; doing
the move without it just relocates the problem.

---

## Deferred on purpose — revisit, do not assume

### T11 — Retention has no scheduled sweep

`src/services/retention.ts` (header) · `src/domain/retention.ts`

`RETENTION_SCHEDULE` carries real numbers and the console lists identities due
for removal, but nothing purges automatically. A person presses the button per
learner.

**This is a decision, and the header already argues it**: anonymisation is
irreversible, the clock depends on activity dates the fixtures only approximate,
and the first unattended run goes against every record at once. A person working
a computed list is how you discover the schedule is wrong while that is still
cheap.

It is on this list because the argument has an expiry date. It holds while the
list is short and somebody is looking at it weekly. It stops holding at the
point where nobody is, and then an unpurged record is a statutory problem rather
than a backlog. The trigger to revisit is the **first real market with real
learners past their anchor date** — not a record count, and not a calendar date.

### T12 — The demonstration accepts a file it cannot hand back

`src/services/uploads/storage.ts` · `README.md` (uploads)

On the fixtures, in a production build, a file is written by a Server Action and
read by a route handler, and those do not share the in-memory `Map`. Under
`next dev` they do, which is what made this look fine until it was run against
`next start`. A deployment with a database has no such seam — both sides read
the same table.

So the demonstration takes an upload and then 404s the link. The two positions
are both defensible and they conflict, which is why this is Steve's and not
mine:

- `config.test.ts:35` states that the stub scanner is "the honest choice" for
  the demo. The existing, documented position is that demo uploads are fine.
- A link that 404s is not honest, and the demonstration's whole job is to show
  the product truthfully.

Refusing uploads where they cannot be served would make the demo honest at the
cost of reversing a decision already written down with reasons. Persisting demo
files to disk would keep both, and adds a file lifecycle to a mode that
deliberately has none. **Do not change this without reading the test that says
otherwise** — the position it records may still be the right one.

---

## Tests and CI

### T13 — Nothing is ever run against Neon

`.github/workflows/ci.yml:93`

The `database` job runs `db:verify`, `db:migrate`, `db:seed` and the parity
suite against a `postgres:16` service container. That proves the schema and the
repositories, and it is most of the value.

What it cannot prove is the thing production actually is: Neon, pooled, over
TLS, with connection limits and cold starts a local container does not have. The
failures that live in that gap — a pooler rejecting a session-scoped setting, a
transaction crossing a cold start — are exactly the ones a container never sees.

A scheduled job against a scratch Neon branch would cover it. It needs a
credential in CI, which is why it is not done, and it should run on a schedule
rather than per push so a pull request never depends on somebody else's database
being up.

### T14 — Three code-mode suites share two addresses and one rate-limit bucket

`e2e/zzzzzzzzzzz-password.spec.ts` · `e2e/zzzzzzzzzzzz-access.spec.ts` ·
`e2e/zzzzzzzzzzzzz-outcome.spec.ts` · `src/services/rate-limit.ts:85`

All three sign in by reading echoed codes for `evance@verdigris.example.edu` and
`admin@ccln.example`. `LIMITS.signIn` is **10 per 60 seconds, keyed by
address**. Each suite is comfortably inside that alone; run together in code
mode they are not reliably inside it, and the failure looks like a broken
sign-in rather than a test-design problem.

All three are skipped unless `AUTH_MODE=code`, so CI never hits this and the
person who does is whoever next runs the real sign-on path by hand — which is
the worst time to meet it. Give each suite its own fixture addresses. Do not fix
it by raising the limit: 10 attempts a minute against one address is the correct
production value and the tests are what is wrong.

### ~~T15 — Raw control bytes in the upload validator~~ — fixed

`src/services/uploads/validation.ts:129` · guard in `uploads.test.ts`

Kept because the failure mode is worth recognising elsewhere. `sanitiseFilename`
strips control characters with `/[\x00-\x1f\x7f]/`, and those three escapes were
**raw bytes** in the source — a literal NUL, US and DEL. The regex behaved
identically, so nothing failed.

Two things went wrong silently. `grep` and ripgrep treat a file containing a NUL
as binary and skip it, so searching this codebase for anything in its most
security-sensitive module returned "binary file matches" or nothing — which is
how it was found, while looking for something else. And the range only held
while all three bytes survived: anything stripping control characters from
source on the way past would leave `[<US><DEL>]`, which no longer covers
0x01–0x1e, and the sanitiser would keep passing its own tests while letting most
control characters through.

The escapes are restored and a test asserts no upload module contains a raw
control byte. It was mutation-tested — reintroducing the bytes fails it on all
three offsets.

---

## Where the rest of the reasoning lives

This file is an index of what is undone, not a second copy of the design record.

- **`docs/user-story.md`** — the programme, phase by phase, and the section
  *Where the product and this story diverge*, written from walking all five
  portals against Postgres. The open questions **Q11**, **Q16**, **Q18**,
  **Q20** and **Q22** are product decisions and live there, not here; they are
  not engineering tasks and would be wrongly shaped as ones.
- **`README.md`** — how to run it, and three traps that are invisible to CI: a
  `.env.local` cannot boot a production build, `reuseExistingServer` will
  silently reuse a stray dev server so a run can appear to test `next start`
  while testing `next dev`, and a file uploaded on the fixtures cannot be served
  back in a production build (T12).
- **`docs/security-and-data.md`** — the data model's obligations, which T3, T9
  and T11 all sit under.
- **Module headers** — `retention.ts`, `registration.ts`, `escalation.ts`,
  `0011_second_factor.sql` and `validation.ts` each argue their own position.
  Where one of those arguments has an expiry date, the entry above says what
  trips it.
