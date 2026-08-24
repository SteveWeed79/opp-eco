# Site review against the Patterson Fellows 2026 application

**Status:** Review. **A and F are built** — see the note under each. The rest
stands as recommended.
**Reviewed:** the site as it stands on `claude/opp-eco-app-review-lufnbs`, against the
Patterson Family Foundation Fellows 2026 application (Melissa Weed, CCLN).
**Purpose:** name where the site and the current vision have come apart, and say
concretely what closing each gap looks like.

---

## The core finding

The application is a **later draft of the vision than the site is.** Nothing on the
site is wrong about the thing it describes; the site describes a smaller thing.

The site is a **program**: paid internships that earn college credit in Kansas
markets, made viable by one workforce board's $20/hour wage reimbursement, launched
city by city. The application is a **business**: connective infrastructure for a
rural talent ecosystem, sold to institutions and communities on annual agreements,
serving learners of all ages, funded through a paired for-profit and nonprofit, with
a subscription dashboard as a second revenue line.

The program is the wedge inside the business. That is a good relationship for them to
have — the problem is only that the site never says so, so a reader who arrives from
the application sees a narrower venture than the one they just read about.

There is also an **audience change the site has not absorbed.** The application lists
`www.opportunityecosystem.org` as the company website. Patterson reviewers will type
that URL. What loads today is a product demonstration for a program that does not yet
exist, with a black banner across the top saying every figure on it is fictional. It
is admirably honest and it is not a front door.

---

## Delta table

| The application says | The site says | Gap |
|---|---|---|
| Company website is `opportunityecosystem.org` | Site brands itself CCLN throughout; `brand.ts` records "Opportunity Ecosystem" as the *former* working title | The URL a funder is given and the name they land on do not match, and nothing bridges them |
| Primary paying customers are education institutions, workforce and economic development organizations, and communities | Landing page addresses students and employers; colleges and boards appear as *operators* of the program, not as customers who buy it | The buyer has no page |
| Three tiers: Starter ~$10K, Regional ~$20–30K, Network ~$40–50K+ | No pricing, no service description, no partnership concept anywhere | The revenue model is invisible |
| Learners of all ages — K–12, college, emerging workers, adults reskilling | Scope is "students earning college credit"; `README.md` records **Q8 resolved: no adult job seekers** | A resolved decision now contradicts the vision |
| Career exposure, job shadows, work-based learning, internships, micro-internships, apprenticeships, training pathways | Two tracks (`standard`, `micro`) plus mentorship as a side entity | Named forms outrun the model, which `product-vision.md` already admits |
| Funding coordination across workforce dollars, scholarships, philanthropy, employer contributions, barrier removal | One funding source: a market's board allocation at $20/hr | The nonprofit foundation's entire function is unrepresentable |
| A nonprofit arm paying internship-credit costs, transportation, wage support | Nothing | The #1 barrier from the 177-student survey — cost of internship credit — cannot be recorded, let alone paid |
| CCLN Pro Dashboard as a second revenue stream, $20K already committed to build it | `/admin` exists and is close to this, but is framed as the platform operator's internal console | The product being sold has no name and no buyer's seat |
| Hybrid for-profit + nonprofit structure | Nothing | Not stated anywhere a partner or funder would see |
| Pilot is Pittsburg State, Emporia State, Fort Hays State, plus a smaller outlier community | Seeded markets are Pittsburg, Emporia, Garden City, Salina, Hays | Three of five match; the rollout a reviewer reads about is not the one they see |
| Measures employment after participation, employment within the region, barriers removed | Lifecycle ends at credit granted; `product-vision.md` flags this as unmodelled | The year-three question has no instrument |
| 177 students surveyed; Kansas WorkforceONE placements; Kansas Micro Internship Program; $20K committed | Landing page shows seeded fictional counts | The real evidence is absent and fictional evidence is in its place |

---

## A. Split the front door from the demo

> **Built.** `/` is the venture; the prototype moved to `/demo` with its banner
> and `noindex` intact. Venture pages at `/`, `/approach`, `/partners`,
> `/evidence`, `/contact`. The name bridge and the hybrid-structure line are in
> the site footer, the contact address is in `brand.ts`, and `front-door.spec.ts`
> asserts the split. The old portal paths 308 to their new homes.
>
> **One thing needs a person:** `contact@opportunityecosystem.org` has to exist,
> or `brand.contactMailbox` needs pointing at an address that does. A published
> address that bounces is worse than the missing one it replaced.

**The single highest-value change, and the cheapest.**

Today `/` is the demo's cover page. It opens with "Paid internships that earn real
academic credit", two calls to action aimed at students and employers, and a
four-figure statistics row — live markets, placements, participating employers,
credit hours granted — computed from seeded fixtures. Above it sits the demonstration
banner. A reader has to hold two contradictory frames at once: these numbers are the
venture's, and also every figure here is fictional.

**What to do:** make `/` the venture's page and move the working prototype to `/demo`.

```
/                    CCLN — what it is, who it serves, what it costs, who is behind it
/partners            The buyer's page (see B)
/approach            The model: what stays the same when it moves, what stays local
/evidence            Customer discovery, the pilot, what is already committed
/contact             A way to reach Melissa
/demo                The prototype, banner intact, noindex intact
/demo/student …      Existing portals, unchanged, moved under /demo
```

`/demo` keeps everything that makes the current site trustworthy: the banner, the
`[Demo]` title prefix, `robots: { index: false }`. The venture pages get indexed. That
split is what lets the honest labelling stay loud without it being the first thing a
funder reads.

**What the new hero looks like:**

> **Rural Kansas does not lack talent, employers, or funding. It lacks the
> connections between them.**
>
> CCLN is the connective infrastructure between education, employers, workforce
> partners, funding, and learners — so a career-connected opportunity that should
> exist actually does, and a learner who should find it can.
>
> `[For communities and institutions]` `[For employers]` `[See the working prototype]`

**What the statistics row looks like**, replacing the four seeded counts:

| 177 | 3 | $20,000 | 2 |
|---|---|---|---|
| students surveyed on what blocks a placement | university communities in the initial pilot | committed to building the Pro Dashboard | systems already connected in practice — a university and Kansas WorkforceONE |

Every one of those is true today and defensible in a room. The current four are not
the venture's numbers at all.

**Also fix, in the same pass:**

- **The name.** Put one line under the mark or in the footer: *"CCLN — the Career
  Connected Learning Network. Formerly Opportunity Ecosystem; still at
  opportunityecosystem.org."* `src/brand.ts` is already the one place a name lives,
  so this is a `formerly` field and one render site.
- **Contact.** The application lists company email as "NA". A funder who wants to
  reply has the founder's personal Gmail and nothing else. A `contact@` on the domain
  plus a `/contact` page is a half-hour of work and it is the difference between a
  venture and a project.
- **Footer.** Currently there is none. It should carry the structure claim — the
  for-profit and the foundation — because that is a question every funder asks and
  the answer is currently nowhere on the web.

---

## B. Give the paying customer a page

The application is unambiguous that the buyer is an institution or a community, not a
student. The site has no surface addressed to that reader. It is the largest missing
thing after A.

**What `/partners` looks like:**

**Section 1 — the problem, in the buyer's words.** Not "students can't find
internships" but the version a workforce director or a provost recognises: *you are
already funding this work, and it is not connecting.* Take it nearly verbatim from
the application's rural-challenge answer, which is written well and written for
exactly this reader.

**Section 2 — what CCLN actually does.** The application lists the service as employer
outreach, opportunity development, participant recruitment, matching, funding
coordination, partner referrals, communication, and ongoing support. That list should
render as eight named things a partner is buying, because "connective infrastructure"
is not something anyone can approve a purchase order against.

**Section 3 — the three tiers.**

| | Starter | Regional | Network |
|---|---|---|---|
| For | One institution or one community testing the model | A region with several partners already active | A multi-county network with education, workforce, employer and community partners |
| Includes | Ecosystem assessment, partner coordination, employer and opportunity development, basic implementation support | Everything in Starter, plus ongoing employer engagement, pathway development, and outcome reporting | Everything in Regional, plus customised strategy, multi-partner implementation, expanded data and reporting |
| Annual | ~$10,000 | ~$20,000–30,000 | ~$40,000–50,000+ |

**Section 4 — what the first year looks like.** A partner buying a $10,000 agreement
is buying a year, and the honest thing to show is the shape of it: assessment in
month one, employer development through months two to four, first placements by month
six, outcome report at twelve. The application already commits to this internally;
saying it publicly is what makes the tier concrete.

**Section 5 — what stays local.** The application's answer to "what stays the same
when the model moves" is one of its strongest passages and it is exactly what a
suspicious local partner needs to hear: standardised intake, onboarding, funding
coordination, data and measurement; locally owned relationships and community
specifics. Put it on the page.

---

## C. Restage the scope as phases rather than quietly widening the claims

The site's scope decisions are recorded honestly and some of them now contradict the
application:

- `README.md` decisions table: *"Who participates — students earning college credit …
  No adult job seekers or unaffiliated career-changers."*
- `docs/user-story.md` open questions: *"**Q8** no adult job seekers"* — listed as
  **resolved**.
- `docs/product-vision.md`: *"The initial release focuses on internships and
  work-based learning that carry college-level credit."*

The application's target market includes "adults seeking to reskill, retrain, or
transition into new careers" as a named beneficiary group, and career exposure
starting well before college.

**The wrong fix is to rewrite those lines to match.** They were correct decisions for
a first release and the credit-bearing internship is still the right wedge — it
involves every participant, real money, and an academic claim, which is what makes it
a proving ground. The right fix is to mark them as **phase decisions rather than
scope decisions**, and to reopen the ones that are now live questions.

**What that looks like in `README.md`:**

| Decision | Choice | Notes |
|---|---|---|
| Who participates | ~~Students earning college credit~~ **Phase 1: learners earning college credit** | Includes dual/concurrent-credit high schoolers. Adult reskilling and pre-college career exposure are in the venture's scope and out of phase 1 — see Q8 |

**What that looks like in `user-story.md`:** Q8 moves out of *Resolved* and back into
*Open*, reworded — not "are adult job seekers in scope" but the question that actually
matters now: *what does an adult learner change?* They have no college verifying them,
often no credit to earn, a different WIOA eligibility category, and a training
provider rather than a college as the education partner. Each of those touches a
different part of the model, and answering it as one yes/no is what would produce a
bad build.

**And add the phase ladder to the site**, on `/approach`, because the application's
own framing — start with credit-bearing internships, extend earlier into exposure and
later into apprenticeship and adult reskilling — is more compelling than either
endpoint alone:

```
Phase 1 (built)      Credit-bearing internships and micro-internships,
                     workforce-funded, in university communities
Phase 2              Earlier: career exposure, job shadows, employer
                     engagement with K–12 and dual-credit
Phase 3              Later: apprenticeships, training pathways,
                     adult reskilling and transitions
Throughout           The Pro Dashboard, and the funding coordination
                     that lets any of these be paid for
```

Say which of those is built. The site's habit of separating what exists from what is
claimed is its best quality; extending that habit up to the venture level costs
nothing and is more persuasive than a claim would be.

---

## D. Model changes the new vision requires

These are the changes where the application describes something the domain cannot
currently represent. Ordered by how much of the vision each one unlocks.

### D1. Funding is one source; it needs to be many

`Market` carries `subsidyBudget`, `subsidyRatePerHour`, and a single `boardId`. Every
funding claim in the system is a workforce board reimbursing $20/hour against approved
hours. The application describes a venture whose distinctive service is **funding
coordination** — workforce dollars, scholarships for internship credit, philanthropic
contributions, employer contributions, and barrier-removal grants from the CCLN
foundation, layered on one placement.

The concrete failure this causes: the 177-student survey's top barrier is the **cost
of internship credit**, and the nonprofit exists partly to pay it. Today there is
nowhere to put that. A student pays tuition to receive credit for work the board is
already subsidising, and the platform cannot record either the cost or the grant that
covered it.

**What it looks like:**

```ts
export type FundKind =
  | "workforce"        // WIOA and equivalent — eligibility-gated, hourly
  | "philanthropic"    // the CCLN foundation and other grantmakers
  | "institutional"    // a college's own scholarship or fee waiver
  | "employer";        // the employer's own wage or fee

export type FundPurpose =
  | "wage_subsidy"     // what the board does today
  | "credit_cost"      // tuition for internship credit — the survey's top barrier
  | "transportation"
  | "stipend"
  | "employer_support";

export interface FundingSource {
  id: string;
  marketId: string;
  sponsorOrgId: string;
  kind: FundKind;
  purpose: FundPurpose;
  programYear: string;
  allocated: number;
  /** Set only where the fund pays by the hour, as the board's does. */
  ratePerHour?: number;
}

export interface FundingCommitment {
  id: string;
  fundingSourceId: string;
  applicationId: string;
  amount: number;
  hours?: number;
  status: "authorized" | "disbursed" | "released";
}
```

`Market.subsidyBudget` becomes the balance of the market's one `workforce` /
`wage_subsidy` source, so the board portal and `marketRemainingBudget` keep working
while the second and third source become expressible. The board's own console barely
changes; what changes is that a market can have more than one pot, and the
foundation's dollars land somewhere countable.

This one is load-bearing for the application's impact claim — *"dollars directed
toward learner access, transportation, internship credit or training costs, wage
support"* — which is unmeasurable without it.

### D2. The network has more kinds of member than three

`organization_kind` is `('business','college','board')`, in the type and in
`0001_initial.sql`. The application names economic development organizations,
community partners, entrepreneurship organizations, chambers, training providers, K–12
districts, and the foundation itself as network members. A network venture whose model
cannot record most of its network is a real limit, not a cosmetic one — the "partner
referrals" service is one of the eight things being sold.

**What it looks like:** a migration adding kinds, plus a light `Referral` record so
"we connected this employer to the SBDC" is a fact the system holds rather than
something in Melissa's inbox.

```sql
-- 0003_partner_kinds.sql
ALTER TYPE organization_kind ADD VALUE 'k12';
ALTER TYPE organization_kind ADD VALUE 'training_provider';
ALTER TYPE organization_kind ADD VALUE 'economic_development';
ALTER TYPE organization_kind ADD VALUE 'community';
ALTER TYPE organization_kind ADD VALUE 'nonprofit';
```

Note the interaction with `canTransact`: vetting currently gates whether an
organization can post or offer mentorship. New kinds need their own answer to what
vetting means for them — an economic development office is not vetted for the reasons
an employer is — so this is an enum change plus one decision, not an enum change
alone.

### D3. `Student` should become `Learner`

`Student` carries `collegeId`, `programOfStudy`, `classStanding`,
`expectedGraduation`. Every field assumes college enrolment. `product-vision.md`
already records that a dual-credit high schooler's *school* is unmodelled; the
application adds adult learners with no enrolment at all.

**What it looks like:** rename the entity, make the education link optional and typed,
and add the discriminator.

```ts
export type LearnerType =
  | "college"          // today's student
  | "dual_credit"      // enrolled in high school, earning college credit
  | "secondary"        // K–12, career exposure only — no credit path yet
  | "adult";           // reskilling or transitioning; may have no institution

export interface Learner {
  // …existing fields…
  learnerType: LearnerType;
  /** The institution granting credit. Absent for exposure-only and most adults. */
  creditingOrgId: string | null;
  /** The institution attended, when different — a high school, a training provider. */
  attendingOrgId: string | null;
  isMinor: boolean;        // drives consent and hour limits; see product-vision
}
```

This is the largest of the model changes and the one to schedule rather than rush —
it touches the theme resolution (which school white-labels the portal), the college's
verification queue, and the credit path. Worth doing before the pilot rather than
during it, because retrofitting a tenancy-adjacent identity mid-pilot is how a data
migration eats a semester.

### D4. Nothing records what happened afterwards

The lifecycle ends at `credit_granted` or `closed`. The application's measurable
impact section promises employment after participation, employment *within the
region*, continued education, and employer retention of participants.
`product-vision.md` already lists this as unmodelled.

**What it looks like:**

```ts
export interface Outcome {
  id: string;
  marketId: string;
  learnerId: string;
  /** The experience this followed, when there is one. */
  applicationId: string | null;
  kind:
    | "employed_by_host"      // the employer who supervised them
    | "employed_in_region"
    | "employed_elsewhere"
    | "continued_education"
    | "entered_training"
    | "no_outcome_recorded";
  recordedOn: string;
  /** Who said so. A self-report and a college's record are different evidence. */
  source: "learner" | "employer" | "college" | "administrator";
  monthsAfter: number;
}
```

`employed_in_region` versus `employed_elsewhere` is the distinction the whole venture
rests on and it should be a first-class value, not a note. It is also the one number
Patterson will ask for at the end of year three, and it takes a year of data to
produce — which argues for building the record before the pilot, even if nothing reads
it for a year.

### D5. `Track` will not hold the forms already named

`Track` is `'standard' | 'micro'`, with mentorship beside it as its own entity, and
`product-vision.md` already names the fix: the forms differ along dimensions — paid or
not, credit-bearing or not, clearance-requiring or not, producing something or not —
and each named experience is a configuration of those. The application names at least
seven forms. Adding them one enum value at a time means seven copies of the workflow
profile.

**What it looks like:** an `ExperienceProfile` the workflow reads, with `standard` and
`micro` as the first two rows and mentorship folded in as a third rather than living
outside the model.

```ts
export interface ExperienceProfile {
  id: string;              // "standard" | "micro" | "job_shadow" | "apprenticeship" …
  label: string;
  compensation: "hourly" | "fixed_fee" | "unpaid";
  creditBearing: boolean;
  requiresFundingClearance: boolean;
  requiresSupervisor: boolean;
  tracksHours: boolean;
  producesDeliverable: boolean;
  durationHint: string;
}
```

This is the one I would **not** do next. It is the right end state and it is a
refactor of the most load-bearing code in the repository — the transition table and
the workflow profiles — for a benefit that only arrives when the third and fourth
experience types do. Do D1, D2 and D4 first; do this when phase 2 is funded.

---

## E. The Pro Dashboard needs a name and a buyer's seat

The application names the CCLN Pro Dashboard twice as the second revenue stream and
notes $20,000 already committed to building it. On the site, the closest thing is
`/admin` — titled "Network Operations", framed as the platform operator's console,
showing what is stuck, the market pipeline, vetting, and the funnel.

That is most of the product, built and working, wearing the wrong label and pointed at
the wrong person. The application describes partners subscribing to see *their own*
ecosystem: employers, opportunities, pathways, resources, funding, and outcomes.
Today's `admin` sees every market; today's `college` sees their market but through a
work-queue lens.

**What it looks like:** a `partner` role and a `/partner` route, reusing the queries
that already exist.

```ts
// src/domain/types.ts
export type ActorRole = "admin" | "student" | "business" | "college" | "board" | "partner";
```

The route renders `marketHealth`, `funnel`, `stalledApplications` and `subsidyDeployed`
for the caller's market — all four already exist in `src/lib/queries.ts` and all four
are already market-scoped through the actor context, which is why this is a new page
rather than new plumbing. What a partner sees that an administrator does not: their
own employers by engagement level, their own funding drawn down, their own outcomes.
What they must not see: anything outside their market, and the same PII redactions the
board gets.

**Cheaper still, and worth doing first:** put the words "CCLN Pro" on the existing
admin console and screenshot it for the application's technology section. The
Fellowship asks what the $20,000 is building. A screenshot of a working dashboard
answers that better than a paragraph.

---

## F. Align the seeded markets to the pilot in the application

> **Built.** Garden City and Salina are gone; Hays moved to `college_engaged`
> with a board and a college in vetting, and Beloit joins at `board_engaged` as
> the outlier. The seed now shows the four-community proving ground the
> application describes.

Seeded markets today: Pittsburg (live), Emporia (configuring), Garden City (board
committed), Salina (board engaged), Hays (prospecting).

The application's pilot: Pittsburg State, Emporia State, Fort Hays State, plus one
smaller outlier community — Ford/Kiowa, McPherson/Marion, or Mitchell/Cloud paired
with Lincoln.

Three of the five already match. **What to change:** promote Hays out of
`prospecting`, and replace Garden City and Salina with one of the outlier pairings —
Beloit in Mitchell County reads best, because Fort Hays Tech North Central is there
and Lincoln County's Make My Move programme gives the pairing a story a reviewer will
remember.

```ts
// src/data/seed.ts — the pilot, as the application describes it
mkt-pittsburg   Southeast Kansas    Pittsburg   live                (unchanged)
mkt-emporia     Flint Hills         Emporia     configuring         (unchanged)
mkt-hays        Smoky Hill          Hays        college_engaged     (was prospecting)
mkt-beloit      North Central       Beloit      board_engaged       (replaces Salina)
```

One file, no schema change, and the rollout section of the landing page then shows the
reviewer their own catchment and their own pilot. The fictional-organizations rule is
untouched: real Kansas cities and counties, invented institutions, which is what the
seed already does.

The outlier matters for the argument, not just the map. The application's scaling
claim is that CCLN is replicable rather than locally lucky, and a fourth community
that is *unlike* the three university towns is what tests it. A rollout list of four
university communities does not.

---

## G. Claim discipline in the copy

Three specific things the site says that the application is careful not to.

**"Your local workforce board pays you $20 an hour."** This is the loudest claim on
the landing page, in white on near-black, and it is the correct employer pitch **in
Southeast Kansas**. It is a Kansas WorkforceONE mechanic, not a universal one — boards
differ, allocations run out, and not every learner is WIOA-eligible, which the domain
model already knows (`unsubsidized` is a real application status). The application
describes funding coordination generically for exactly this reason.

Change it to survive a market where it is not true: *"In markets where the local board
funds it, you are reimbursed $20 an hour — roughly $4,200 back over a semester. Where
it does not, we find what does."* That second clause is the actual service being sold,
and the current page gives it away for free.

**"Four participants, one workflow."** The application names learners, employers,
education partners, workforce organizations, economic development organizations,
community partners, and funders. Four is the demo's cast, not the network's.
`/approach` should show the wider set even while the prototype implements five roles —
with the built ones marked as built.

**"Internship."** The site says internship throughout; the application says
career-connected experience, and means it, because internships are one form among
several. Change the vocabulary on the venture pages and leave it alone inside the
demo, which really is about internships. Vocabulary that outruns the build is how a
demo starts lying.

---

## What not to change

Worth saying plainly, because a review that only lists gaps invites over-correction.

- **The demonstration banner, the `[Demo]` title prefix, the noindex on the
  prototype, and the inline assumption markers stay.** They are the reason the site
  reads as credible rather than as vapourware, and a funder who finds an unlabelled
  mockup will not trust the next thing they are told. Section A moves them behind a
  front door; it does not remove them.
- **`docs/product-vision.md`'s "Where this does not yet match the build" table
  stays, and should grow.** Every gap in this review that is not closed belongs in
  that table. A venture that publishes its own gap list is making a credibility
  argument most cannot make.
- **The architecture holds.** One state machine, one write path, market-scoped reads,
  server-side re-authorization, notifications inside the transaction. Every change in
  section D is additive to that design rather than a departure from it — which is the
  single best signal in this repository about whether the wider vision is buildable
  by this team.
- **The $20/hour mechanic itself.** Generalise the *claim*; keep the *feature*. It is
  the thing that makes the Southeast Kansas pilot work, and the application is right
  that it is the employer's whole reason to participate there.

---

## Two decisions only the founder can make

**Publish the prices, or publish the shape?** *(Decided: shape only. `/partners`
describes the three tiers by scope and says, on the page, why there is no figure
on it.)* The application states three tiers with figures. Putting exact dollars on a public page before a single institution has paid
one sets an anchor that is hard to move, and the application itself names willingness
to pay as the central unvalidated assumption. My recommendation: publish the three
tiers by *scope* — what each includes, who each is for — and give the figure as a
range with "typical annual investment" framing. It reads as confident rather than
provisional, and it leaves room to learn what the pilot teaches. If the goal is to
signal seriousness to a funder specifically, the full figures on `/partners` are
defensible and I would not argue against it.

**Does phase 1 admit adult learners?** The site's Q8 says no and the application's
target market says yes. These can both be true if phase 1 stays credit-bearing and
adults enter in phase 3 — but the site should say which, because a workforce board
reading the site will assume the answer applies to the money they are being asked to
commit. This is the decision I would make before writing any of the copy in section
A, since it changes who the front door addresses.

---

## Sequencing

| | Work | Why here |
|---|---|---|
| ~~Now~~ **Done** | A (front door split, real numbers, name bridge, contact) | A funder may type the URL this week. Days of work, not weeks. |
| ~~Now~~ **Done** | F (seed alignment to the pilot) | One file. Makes the demo show the pilot the application describes. |
| **Now** | E, cheap half — name the dashboard "CCLN Pro", screenshot it | Answers "what is the $20,000 building" with a picture. |
| **Next** | B (`/partners`) and G (claim discipline) | The revenue model's first public expression. Needs the pricing decision above. |
| **Next** | C (phases, reopen Q8) | Cheap, and it is what stops the other changes reading as overreach. |
| **Before the pilot** | D1 (funding sources), D4 (outcomes) | Both need to exist *before* data starts arriving, or year one is unmeasurable in the terms the application promises. |
| **Before the pilot** | D3 (`Learner`) | Identity refactors get more expensive every month there is real data. |
| **With phase 2** | D2 (partner kinds), E full (partner portal) | Follow the first partner who is neither a college nor a board. |
| **With phase 3** | D5 (experience profiles) | The refactor pays for itself at the third experience type, not the second. |

---

## One-line summary

The site is a good demonstration of the program and not yet a front door for the
venture; the fastest path to alignment is to stop making one page do both jobs, then
to give the paying customer, the wider funding model, and the outcome measure the
places in the product they currently do not have.
