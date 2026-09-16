# The Regional Report

The platform tracks internships and mentorships. The **report** looks at a rural
town as a whole and asks how it compares to towns like it — and, where a town is
doing unusually well, what it is doing that another town could copy.

That second half is the product. A number that says "you are losing 75% of your
graduates" makes somebody feel bad. A number paired with *what the town keeping
95% does differently* is something a chamber can act on in a month.

This note is the design for that report: what it is built on, how comparison
works when every town is small, and — first, because it is the only part with a
deadline — what has to be captured now because it cannot be reconstructed later.

---

## Cheap now, impossible later

Four things get permanently more expensive every month they wait. One of them is
now done. Nothing else in this document is urgent.

| | Why it cannot wait |
|---|---|
| **The field instrument is standardised before the visits scale** | Towns reviewed with different questions are not comparable. The first nineteen visits cannot be re-walked |
| ~~**Outcomes capture the employment *county*, not an in-region boolean**~~ — **done**, migration `0014_outcome_place.sql` | "In region" recorded as a tick is a judgement that cannot be re-derived when the boundary you meant turns out to be wrong. Captured from here on; the rows written before it keep what the recorder claimed, labelled as a claim rather than converted into a county nobody gave |
| **The measurement interval for outcomes is fixed** (`Q23`) | You cannot phone somebody eighteen months later and ask where they were at three months. A late decision does not delay the report; it permanently shortens the series |
| **Area totals are snapshotted each period** | Without them the retention schedule eventually anonymises the records the history was computed from, and takes the history with it |

Everything else — peer selection, the report surface, the playbook library — can
be built at any time from data collected correctly.

---

## Who it is for

Rural towns and small cities. Large cities are explicitly out of scope: they do
not have this problem, and including one destroys the comparison for everybody
else, because nothing in the data would be its peer.

That scoping is a gift. The entire population range is roughly 5,000–50,000,
every participant is the same kind of place with the same problem, and peer
selection becomes easy rather than fraught.

**Two audiences, and they want different things from the same data.**

- **The town** wants description: *we ran 14 internships, 9 stayed, here are the
  employers, here is how we compare to our five closest peers.* Those are exact
  counts about a complete population — a census, not a sample — so they need no
  statistical hedging at all.
- **The state, or a funder** wants inference: *across 12 rural Kansas
  communities, students who completed a local internship stayed in region at X%
  against Y% for those who did not.* Pooling across towns is what produces an n
  large enough to support that claim, and it is the number that argues for the
  programme at legislature level.

The same collected data serves both. Neither can be derived from the other.

---

## Three data sources

**1. The field review** — a structured assessment of the town, conducted in
person. The largest source, the most defensible, and the one with the deadline.

**2. The platform** — internships and mentorships that ran through the system:
placements, employers, credit, dwell time, outcomes. Small per town, unique to
us, and the only source that links a *named local employer* to a *named
student's* retention.

**3. Public data** — census, enrolment, unemployment, wage records. Commodity:
anyone can get it. It supplies context and denominators, and it is the only
source that covers towns which are not customers.

The moat is the first two. It is worth being precise about that, because it
decides what to build: nobody else has walked forty rural Kansas towns with one
instrument, and nobody else knows which employer hosted which student.

---

## The field review

A **feet-on-the-ground assessment** touching as many measurable points of a rural
town as possible — conducted by the administrator, in the town, over coffee with
the people who run it.

### Why it carries the comparison

The internship data is thin: fourteen placements, nine stayed. The field review
is **n = 1 per town and complete** — a census of that town's characteristics
rather than a sample of anything. Forty towns assessed on the same instrument
compare without any statistical fragility whatever.

So the assessment carries the comparison and the outcome data corroborates it.
That is the opposite of the obvious assumption, and it is what makes the report
work at rural scale.

### It has to be an instrument, not a conversation

Fixed dimensions, fixed scales, fixed definitions, every town, every visit. A
review that varies by town produces data that cannot be compared, which is the
same failure as an in-region boolean and a far more expensive one.

The dimensions are the administrator's to set — this is domain knowledge from
the field, not from here. The ones that recur hardest in rural retention, and
that the instrument should be checked against:

- **Housing** a young professional would actually take. The single most
  frequently cited rural retention blocker, and no amount of employer engagement
  substitutes for it
- **Childcare** capacity and cost
- **Employer base** by sector: who exists, who hosts, who would
- **The education pipeline**: programmes offered, enrolment, and the career
  services capacity to actually place people
- **Civic capacity**: is there a functioning chamber or economic development
  organisation, and does it have anyone in it
- **What the town already runs** — existing programmes, formal or not
- **Broadband and transport**
- **Amenities** for somebody in their twenties
- **Whether anyone local is driving it.** Soft, unquantifiable, and probably
  predicts more of the variance than the rest combined

### What it produces

A **town profile** that accumulates across visits, and **findings** — each with a
source and a date, because a fact from a chamber director in 2026 is not the same
object as one from a dean in 2028.

A finding is the unit that becomes a **playbook entry**: the thing a town with
the opposite problem can copy.

---

## Place, and what "region" means

`employed_in_region` versus `employed_elsewhere` is the right distinction and the
wrong mechanism. As a boolean it is a judgement made by whoever records it, and
different colleges will draw the line differently — Pittsburg is twenty miles
from Joplin, across a state line. A comparison broken that way still renders as a
clean chart.

**Capture the county of employment instead, and derive in-region from it.**

- Consistent across markets without anybody agreeing to anything
- Recomputable when boundaries change, which they do
- One captured field answers town, county, workforce area, MSA and state
  roll-ups — which is how town/city/regional views come from a single question

**This is built.** `Outcome` carries `employmentCounty`, `employmentState` and
`employedByHost`; `Market` declares the `counties` and the `state` it is measured
against; and `inRegion` derives the answer rather than reading one. Three notes
on the shape it took:

- **A hire by the host needs no county.** The host is an employer in this market,
  so the strongest result the programme produces is also the cheapest to record.
- **The county is optional, and its absence is its own figure.** A follow-up that
  established somebody is working without establishing where is a real
  half-answer. It counts as `placeUnknown` rather than as having left, so a gap
  in the asking can never read as a bad result — the same principle as counting
  unmeasured learners separately.
- **The old rows kept their claim.** Nobody recorded a county for them and nobody
  can be phoned two years later to ask, so `assertedInRegion` holds what the
  recorder asserted and is used only when there is no captured place. No county
  was invented in the backfill.

Regions are predetermined, measurable, county-based boundaries defined at state
level rather than per market. The natural candidate is the **board's own WIOA
local workforce development area**: county-defined, publicly documented, and
already the geography the board is measured on. *Confirm which counties the
pilot board covers rather than assuming.*

**Boundaries move.** Local areas are redesignated and MSAs are redrawn after each
census, so region definitions need effective dates and every snapshot must record
which boundary set produced it. Otherwise a redesignation silently rewrites
history and a trend line moves for reasons unrelated to performance.

Rural commute sheds are wide — thirty or forty miles is ordinary, often across
county lines — which makes the captured county matter *more* here than it would
in a city, not less.

---

## Peer selection

Pittsburg and Wichita do not compare. Pittsburg and Hays do.

**Population is the primary axis and is not sufficient on its own.** A town of
20,000 with no college is not a peer of Pittsburg on anything being measured
here. Peer selection should combine population with at least the presence and
type of a higher-education institution.

**Nearest-N, not fixed bands.** With hard boundaries, a town at 24,900 and one at
25,100 never compare despite being indistinguishable. "Your five closest peers"
avoids the cliff, reads more naturally, and degrades gracefully while the
customer list is short.

**Separate peer grouping from metric denominators.** They are two different uses
of population and conflating them causes trouble:

- *Grouping* — is this a comparable place? City population.
- *Denominator* — is this rate fair? Per metric. Placements per 100 enrolled
  students; economic activity per 1,000 regional population.

Lead with per-enrolled-student, which speaks to what an institution controls.

### A note on sequencing

Peer group and sales cluster are the same list. Pittsburg, Hays and Emporia are
in the same population band and built around the same kind of regional
university. Landing those three gives *each of them* a complete peer group
immediately. Adding a large city gives a bigger number and a worse product.

Early on, peer comparison works on **context** metrics for any town from public
data, and on **platform** metrics only for customers. The first version of the
report can show a town its peers on context plus its own platform figures
unpeered, and improve with every institution that signs.

---

## Comparison: outliers, not rankings

The question is not "who is best." It is: *this town of 5,000 keeps 95% and that
town of 5,000 loses 75% — what is the first one doing?*

That is outlier detection, and it is far more robust at small n than ranking. A
95%-versus-25% gap is real at these numbers. A 70%-versus-62% gap is noise, and
the report should decline to draw it.

**Design rule: only surface a difference large enough to be real, and always show
n beside a rate.** `68% (n=31)` makes a reader calibrate automatically, and it is
one line of formatting.

### The small-numbers artefact

Small populations produce extreme values by chance. It is why the counties with
the highest *and* the lowest cancer rates are always tiny rural ones. Scan a
hundred small towns for outliers and the top and bottom of the list will be
disproportionately the smallest towns, some of them there purely by luck.

A town of 8 at 100% is much weaker evidence than a town of 40 at 85%, and on a
chart they look identical. So:

- judge a deviation against what chance would produce **at that town's n**
- shrink small-n estimates toward the peer mean before ranking
- distinguish "unusually high, and we are confident" from "high, but n = 8"

Without this the first case study will be a town that got lucky, and the playbook
extracted from it will not reproduce.

### Practice metrics carry the "how"

The outcome gap says where to look. It does not say what to copy. The report
should pair every gap with what differs:

> Ellsworth retains 95%. Three times the employers per student, placements clear
> the board in 9 days against a peer median of 34, and 80% are credit-bearing
> against 30%.

Several of these already exist: employers participating, dwell time in the pause,
share credit-bearing, the mentorship-to-internship mix. One worth adding is
**employer repeat rate** — did this employer host again? It is derivable from
data already held, and a town whose employers come back has something working
that a town of one-and-done employers does not.

### Diagnosis, not description

Capacity paired with outcome tells a town *which* problem it has:

| Pattern | Finding |
|---|---|
| Low retention, no housing a 24-year-old would take | Housing. No amount of employer engagement fixes it |
| Low retention, strong everywhere except employers hosting | Directly transferable playbook |
| Low retention, strong everywhere, high wages one county over | Losing to a neighbour rather than failing |

Three different interventions, same bad number.

---

## Snapshots

**The report reads snapshots, never records.** Each period, each area's totals are
computed and frozen.

Three things follow, and the third is the one that would otherwise bite hardest:

1. The comparative layer physically cannot touch PII — privacy by construction
   rather than by policy
2. Cross-market reads stop fighting market scoping, because there are no
   market-scoped records to read
3. **The time series survives the retention purges.** A learner anonymised in
   2031 does not disturb the 2026 area total, which was computed and frozen in
   2026. Without snapshots the privacy design quietly eats the history

Each snapshot records the boundary set and instrument version it was produced
under.

---

## Cadence

**Annual**, for most customers.

Pitt State's College of Business at 20–72 placements a semester is at the *large*
end of this market; a rural community college may run five to ten. Quarterly or
per-semester reporting would mostly render empty. Anything cut finer than a total
should use a multi-year rolling window.

This is not a limitation to work around. It is the honest cadence for the data.

---

## Privacy at this scale

The careful work already done — PII out of notifications, consent scoped to the
source institution, retention that anonymises rather than deletes — is
straightforward to undo with a report, because an aggregate does not look like a
disclosure.

At 72 placements across an entire college, it is one. "Three welding students
placed at Smith Manufacturing" names three people to everybody in town, and Smith
knows exactly who. **Employer-level breakdowns are the most interesting cut and
are probably not publishable.**

Standard suppression thresholds are not a trimming knob here; at n = 30 a
threshold of 10 blanks the entire report. The answer is not to suppress small
cells but to **build a report that does not offer cuts that small** — counts,
composition, trend, and a small number of robust rates with n always visible.

**Name the exemplars; do not name the laggards.** Nobody objects to being cited
as the town doing something well, and a town at the bottom sees its own full
picture without being held up beside a name. It resolves the consortium problem
and it is better product.

**Field notes naming local people sit behind the assessment data**, not inside
what a customer can log in and read. Otherwise the honest ones stop being
written.

---

## What the platform must capture

Derived from everything above, in priority order:

1. ~~**Employment county** on `Outcome`, replacing the in-region boolean~~ —
   **done**
2. **Counties and region definitions** as reference data, with effective dates
3. **Area snapshots** per period, stamped with boundary set and instrument version
4. **The field instrument**: town profile, dated findings with sources, playbook
   entries
5. **Employer repeat rate** — derivable now, no new capture needed
6. **A town brief** for the administrator: population and peer set, enrolment,
   employers and repeat rate, placements, dwell time, retention, peer position,
   and what was recorded last visit. The difference between an informed first
   conversation and a getting-to-know-you one

---

## Open questions

| | |
|---|---|
| **Q23** | Who records an outcome, and on what interval? Load-bearing for everything here, and the clock is running |
| **Instrument dimensions** | The administrator's to define. This note lists candidates, not answers |
| **Region boundary** | Confirm the pilot board's WIOA local area counties |
| **Non-participant retention** | Do interns stay at a higher rate than non-interns? The platform holds the intern half cleanly; the other half needs college or state data. Worth more than the rest of the report combined |
| **Who sees which cut** | A college paying for the platform may be shown as the bottleneck. Decide deliberately rather than discovering it with a customer |
| **Scale** | The insight comes from somebody visiting towns, so the business scales at the rate she can travel. The instrument is what makes that transferable to a second person |
