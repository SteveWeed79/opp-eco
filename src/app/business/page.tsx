import Link from "next/link";
import {
  CircleDollarSign,
  Clock,
  FileText,
  HandHeart,
  HelpCircle,
  Users,
  Zap,
} from "lucide-react";
import {
  Assumption,
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  Money,
  PageHeader,
  PageSection,
  PostingStatusBadge,
  ProgressBar,
  Stat,
  StatusBadge,
  TableWrap,
  Td,
  Th,
  ToneCard,
  TrackBadge,
} from "@/components/ui";
import {
  TransitionActions,
  MENTORSHIP_CONFIRM,
  POSTING_CONFIRM,
} from "@/components/TransitionActions";
import { postingMachine } from "@/domain/lifecycle";
import { mentorshipFormatLabel, mentorshipMachine } from "@/domain/mentorship";
import {
  mentorshipLifecycleAsBusiness,
  postingLifecycleAsBusiness,
} from "@/app/_actions/lifecycle";
import { repositories } from "@/data/backend";
import { nameLookups } from "@/lib/names";
import { actorForPortal } from "@/auth/session";
import { reviewQueue, unreviewedWeeksByApplication } from "@/services/timesheet";
import { ApproveHours } from "./ApproveHours";
import { availableTransitions, fundingCommitment, isTerminal } from "@/domain/workflow";
import { postingTotalHours } from "@/domain/types";
import { marketRemainingBudget } from "@/lib/queries";
import { businessTransition } from "./actions";
import { NewPosting } from "./NewPosting";
import { OfferMentorship } from "./OfferMentorship";

export default async function BusinessPage() {
  const actor = await actorForPortal("business");
  const { organizationName } = await nameLookups(actor);
  const [unreviewedWeeks, hoursQueue] = await Promise.all([
    unreviewedWeeksByApplication(actor),
    reviewQueue(actor),
  ]);
  const org = (await repositories.organizations.find(actor, actor.membership.organizationId!))!;
  const market = (await repositories.markets.find(actor, actor.membership.marketId!))!;
  const boardName = organizationName(market.boardId);
  const postings = await repositories.postings.list(actor);
  const applications = (await repositories.applications.list(actor)).filter(
    (a) => !isTerminal(a.status),
  );

  const active = applications.filter((a) =>
    ["placement_active", "funding_authorized"].includes(a.status),
  );
  const reimbursed = active.reduce((sum, a) => sum + fundingCommitment(a), 0);
  const needsHelp = postings.filter((p) => p.status === "help_requested");
  // Part of the transition context every row needs. No employer transition is
  // budget-guarded today, but the state machine asks for it, and computing it
  // once here keeps it out of the row loop.
  const remainingBudget = await marketRemainingBudget(actor, market);

  // Skills already in use across this market's postings, offered as the
  // vocabulary for a new one. Free-text tags sprawl into "JS", "Javascript",
  // and "JavaScript", and match scoring compares them literally.
  const skillVocabulary = Array.from(
    new Set(postings.flatMap((p) => [...p.skillsRequired, ...p.skillsPreferred])),
  ).sort();

  // This employer's own offers to mentor. Withdrawn ones are gone rather than
  // greyed out: the machine has no move away from withdrawn, so a row with no
  // buttons and no way back is a tombstone the employer cannot act on.
  const mentorshipOffers = (await repositories.mentorshipOffers.list(actor)).filter(
    (o) => o.status !== "withdrawn",
  );
  // Mentorship topics converge on the same vocabulary as posting skills, plus
  // whatever other mentors in this market already named. A separate free-text
  // field would sprawl into "UX", "UX design", and "User experience" exactly
  // the way skill tags do.
  const topicVocabulary = Array.from(
    new Set([
      ...skillVocabulary,
      ...(await repositories.mentorshipOffers.openInMarket(actor)).flatMap((o) => o.topics),
      ...mentorshipOffers.flatMap((o) => o.topics),
    ]),
  ).sort();
  const college = (
    await repositories.organizations.list(actor, { kind: "college" })
  ).find((o) => o.marketId === market.id);
  const hoursPerCredit = college?.hoursPerCredit ?? 45;

  /**
   * Live candidates against a posting — what the close guard reads, so the
   * button and the service agree about whether closing would strand anyone.
   */
  const openCounts = new Map(
    await Promise.all(
      postings.map(
        async (posting) =>
          [
            posting.id,
            (await repositories.applications.forPosting(actor, posting.id)).filter(
              (a) => !isTerminal(a.status),
            ).length,
          ] as const,
      ),
    ),
  );
  const openApplicationsFor = (postingId: string) => openCounts.get(postingId) ?? 0;

  /**
   * The student behind each candidate row, resolved before the table renders.
   *
   * Keyed by *application* and read through `forApplication`, not through a
   * flat map of `students.list`. That is the whole point: this repository
   * method redacts an employer's view down to what the placement's current
   * stage discloses, and a listing would hand this page the unredacted record
   * for every student in the market. Same call per row as before, just made
   * where a component is still allowed to await.
   */
  const studentByApplication = new Map(
    await Promise.all(
      applications.map(
        async (application) =>
          [
            application.id,
            await repositories.students.forApplication(actor, application),
          ] as const,
      ),
    ),
  );
  const postingById = new Map(postings.map((p) => [p.id, p]));

  // Total interest per posting, as opposed to `openCounts` which excludes
  // terminal applications. Counted once here because the micro-project card
  // asked for it three times per row.
  const interestCounts = new Map(
    await Promise.all(
      postings.map(
        async (posting) =>
          [
            posting.id,
            (await repositories.applications.forPosting(actor, posting.id)).length,
          ] as const,
      ),
    ),
  );



  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16 space-y-8">
      <PageHeader
        dark
        eyebrow="Employer portal"
        title={org.name}
        subtitle={`${org.county} County · ${postings.filter((p) => p.status === "published").length} live postings`}
        action={
          <NewPosting
            county={org.county}
            skillVocabulary={skillVocabulary}
            hoursPerCredit={hoursPerCredit}
          />
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* The reimbursement is the reason a business is here at all           */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6 bg-good-50 border-good-100">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <span className="w-11 h-11 rounded-card bg-gradient-to-br from-good-600 to-good-700 text-white shadow-e1 flex items-center justify-center shrink-0">
              <CircleDollarSign className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-black text-ink-950">
                {boardName} reimburses you ${market.subsidyRatePerHour}/hour
              </h2>
              <p className="text-sm text-ink-600 mt-1 max-w-xl">
                For every standard internship hour your intern works after board
                clearance. You pay the wage; the board pays you back.
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold text-ink-600 uppercase tracking-wider">
              Authorized this year
            </p>
            <p className="text-3xl font-black text-good-700 tabular">
              <Money value={reimbursed} />
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Live postings" value={String(postings.filter((p) => p.status === "published").length)} />
        <Stat label="Candidates in pipeline" value={String(applications.length)} />
        <Stat label="Interns on site" value={String(active.length)} tone="good" />
        {/* "Awaiting your review" sat directly above a card headed "Hours
            awaiting your approval" showing two rows while this read 0. Both
            were right — they count different things — which is exactly why one
            of them had to say which. */}
        <Stat
          label="Candidates to review"
          value={String(
            applications.filter((a) => ["submitted", "under_review"].includes(a.status))
              .length,
          )}
          tone={
            applications.filter((a) => ["submitted", "under_review"].includes(a.status))
              .length > 0
              ? "warn"
              : "neutral"
          }
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Zone 1 — work that is blocking somebody else.                       */}
      {/*                                                                     */}
      {/* Rendered only when there is something in it. A permanent empty      */}
      {/* "needs you" heading teaches an employer that the heading means      */}
      {/* nothing, which is exactly the habit that loses the queue.           */}
      {/* ------------------------------------------------------------------ */}
      {(needsHelp.length > 0 || hoursQueue.length > 0) && (
        <PageSection
          title="Needs you today"
          description="A student cannot be paid, earn credit, or close out a placement until you clear these."
        >

      {/* ------------------------------------------------------------------ */}
      {/* Assisted drafting — a business that doesn't know how to scope work  */}
      {/* ------------------------------------------------------------------ */}
      {needsHelp.length > 0 && (
        <ToneCard tone="warn" elevation="floating">
          <CardHeader
            level={3}
            icon={<HelpCircle className="w-5 h-5 text-warn-600" />}
            title="Drafts you asked the college to help with"
            subtitle={`${organizationName(market.collegeIds[0])} will scope these into postings students can actually apply to`}
          />
          <ul className="row-list divide-y divide-line">
            {needsHelp.map((posting) => (
              <li
                key={posting.id}
                className="px-6 py-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink-950">{posting.title}</span>
                    <TrackBadge track={posting.track} posting={posting} />
                  </div>
                  <p className="text-xs text-ink-500 mt-1 max-w-xl">
                    {posting.description}
                  </p>
                </div>
                <Badge tone="warn">With the college</Badge>
              </li>
            ))}
          </ul>
        </ToneCard>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Hours awaiting sign-off                                             */}
      {/*                                                                     */}
      {/* Above the pipeline deliberately. A student cannot be paid, cannot   */}
      {/* earn credit, and cannot have their placement closed out until these */}
      {/* are cleared, and the employer is the only party who can clear them. */}
      {/* ------------------------------------------------------------------ */}
      {hoursQueue.length > 0 && (
        <ToneCard tone="warn" elevation="floating">
          <CardHeader
            level={3}
            icon={<Clock className="w-5 h-5 text-warn-600" />}
            title="Hours awaiting your approval"
            subtitle="The board reimburses against these, and the college counts them toward credit"
          />
          <ul className="row-list divide-y divide-line">
            {hoursQueue.map(({ entry, posting, studentName }) => (
              <li key={entry.id} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-ink-950">
                      {studentName}
                      <span className="font-normal text-ink-500">
                        {" · "}
                        {posting.title}
                      </span>
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5 tabular">
                      Week of{" "}
                      {new Date(`${entry.weekStarting}T12:00:00Z`).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric", timeZone: "UTC" },
                      )}{" "}
                      · {entry.hours} hours
                    </p>
                  </div>
                  <ApproveHours
                    entryId={entry.id}
                    hours={entry.hours}
                    studentName={studentName}
                  />
                </div>
                {/* What they say they did. Approving without it visible is a
                    signature on a blank page. */}
                <p className="text-xs text-ink-600 mt-2 italic border-l-2 border-line-strong pl-3">
                  &ldquo;{entry.summary}&rdquo;
                </p>
              </li>
            ))}
          </ul>
        </ToneCard>
      )}

        </PageSection>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Zone 2 — who is in flight                                           */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Your candidates"
        description="Everyone currently moving toward a placement with you, and the move each one is waiting on."
      >
      <Card>
        <CardHeader
          level={3}
          icon={<Users className="w-5 h-5" />}
          title="Candidate pipeline"
          subtitle="Contact details unlock after board clearance"
        />
        {applications.length === 0 ? (
          <Empty>No candidates yet.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <Th>Candidate</Th>
                  <Th>Opportunity</Th>
                  <Th>Match</Th>
                  <Th>State</Th>
                  <Th>Reimbursement</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody className="row-list divide-y divide-line">
                {applications.map((application) => {
                  // Redacted at the repository, not in the markup — withheld
                  // fields never reach this page in the first place.
                  const student = studentByApplication.get(application.id) ?? null;
                  const posting = postingById.get(application.postingId) ?? null;
                  if (!student || !posting) return null;
                  const commitment = fundingCommitment(application);

                  return (
                    <tr key={application.id}>
                      <Td className="whitespace-nowrap">
                        <span className="font-semibold text-ink-950">{student.name}</span>
                        <span className="block text-xs text-ink-500">
                          {student.programOfStudy} · {student.classStanding}
                        </span>
                      </Td>
                      {/* The widest cell, and the one that can afford to give.
                          Held on one line it pushed the action column 106px
                          past the card, so the buttons at the end of every row
                          were half-visible until you scrolled a table nobody
                          expects to scroll. A wrapped job title costs nothing. */}
                      <Td>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{posting.title}</span>
                          <TrackBadge track={application.track} posting={posting} />
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={application.matchScore.score >= 85 ? "good" : "brand"}>
                          {application.matchScore.score}%
                        </Badge>
                      </Td>
                      <Td>
                        <StatusBadge status={application.status} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {application.track === "micro" ? (
                          <span className="text-xs text-ink-500">
                            Fixed fee — not reimbursed
                          </span>
                        ) : commitment > 0 ? (
                          <span className="font-semibold text-good-700">
                            <Money value={commitment} />
                          </span>
                        ) : (
                          <span className="text-xs text-ink-500">Pending clearance</span>
                        )}
                      </Td>
                      <Td>
                        {/* Rendered from the state machine rather than from a
                            list of statuses maintained here. Adding a
                            transition to the table makes its button appear;
                            a guard failing makes it disappear. */}
                        <TransitionActions
                          id={application.id}
                          action={businessTransition}
                          subject={`${student.name} — ${posting.title}`}
                          transitions={availableTransitions(actor, {
                            application,
                            student,
                            remainingBudget,
                            postingOwnerId: posting.businessId,
                            unreviewedWeeks: unreviewedWeeks.get(application.id) ?? 0,
                          }).map((t) => ({ to: t.to, label: t.label }))}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      </PageSection>

      {/* ------------------------------------------------------------------ */}
      {/* Zone 3 — the three ways to take part, in one place.                 */}
      {/*                                                                     */}
      {/* These used to be three cards scattered down the page with three     */}
      {/* differently-styled create buttons: "Post an opportunity" in the     */}
      {/* page header, "Post a project" buried inside the micro card, and     */}
      {/* "Offer to mentor" at the very bottom, 2,100px down. An employer     */}
      {/* who could not take an intern never reached the two things they      */}
      {/* could have said yes to.                                             */}
      {/*                                                                     */}
      {/* Grouped, they read as one decision with three sizes — which is what */}
      {/* they are — and the smallest commitment is no longer the hardest to  */}
      {/* find.                                                               */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="What you're offering"
        description="Three sizes of the same thing: a semester of paid work, a scoped project, or an hour of your time. You can do any of them, and pause any of them."
      >
      <Card>
        <CardHeader
          level={3}
          icon={<FileText className="w-5 h-5" />}
          title="Your postings"
          subtitle="Nothing reaches students until the college has reviewed it"
        />
        {postings.length === 0 ? (
          <Empty>No postings yet.</Empty>
        ) : (
          <ul className="row-list divide-y divide-line">
            {postings.map((posting) => (
              <li key={posting.id} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/opportunities/${posting.id}`}
                        className="font-semibold text-sm text-ink-950 hover:text-brand-700 transition-colors"
                      >
                        {posting.title}
                      </Link>
                      <TrackBadge
                        track={posting.track}
                        posting={posting}
                        hoursPerCredit={hoursPerCredit}
                      />
                      <PostingStatusBadge status={posting.status} />
                    </div>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {posting.county} County ·{" "}
                      {openApplicationsFor(posting.id)} in pipeline
                    </p>
                  </div>
                  <TransitionActions
                    id={posting.id}
                    action={postingLifecycleAsBusiness}
                    subject={posting.title}
                    confirm={POSTING_CONFIRM}
                    transitions={postingMachine
                      .available(actor, {
                        posting,
                        openApplications: openApplicationsFor(posting.id),
                      })
                      .map((t) => ({ to: t.to, label: t.label }))}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* The two lighter commitments, as siblings rather than as a stack.    */}
      {/*                                                                     */}
      {/* Stacked full-width they ran to roughly 600px, which put mentorship  */}
      {/* below the fold on every screen. Side by side they are half that and */}
      {/* read as what they are: two alternatives to the same "I can't take   */}
      {/* an intern this term", not two unrelated afterthoughts.              */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-6 lg:grid-cols-2 items-start">
      <Card>
        <CardHeader
          level={3}
          icon={<Zap className="w-5 h-5 text-micro-600" />}
          title="Not ready for a full semester?"
          subtitle="Start with a project, see the work, then convert"
        />
        {/* One column: this card is half-width now, so the old two-up split
            gave each side about 200px and broke the copy into ladders. */}
        <div className="px-6 py-5 space-y-5">
          <div>
            <p className="text-sm text-ink-600">
              A micro-internship is a 5–40 hour project with a fixed fee and a defined
              deliverable. No board interview, no semester commitment — a working
              interview that turns into a standard internship in one click if it goes
              well.
            </p>
            <div className="mt-4">
              <Button variant="primary" size="sm">
                Post a project
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {postings
              .filter((p) => p.track === "micro" && p.status === "published")
              .map((posting) => (
                <div
                  key={posting.id}
                  className="rounded-xl border border-micro-100 bg-micro-50 p-4"
                >
                  <p className="font-semibold text-sm text-ink-950">{posting.title}</p>
                  <p className="text-xs text-ink-600 mt-1">
                    <Money value={posting.projectFee ?? 0} /> ·{" "}
                    {postingTotalHours(posting)} hrs · due in {posting.dueWithinDays} days
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      value={interestCounts.get(posting.id) ?? 0}
                      label={`Interest in ${posting.title}`}
                      max={Math.max(3, interestCounts.get(posting.id) ?? 0)}
                      tone="brand"
                    />
                    <p className="text-xs text-ink-600 mt-1">
                      {interestCounts.get(posting.id) ?? 0} interested
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div className="px-6 pb-5">
          <Assumption>
            Micro-internships are unsubsidized here (Q13) — a fixed project fee has no
            hours for an hourly reimbursement to attach to.
          </Assumption>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Time, with nothing else attached — the smallest thing on the page   */}
      {/* an employer can say yes to, and so the one that must not be last.   */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          level={3}
          icon={<HandHeart className="w-5 h-5 text-brand-700" />}
          title="Can't take an intern? Offer an hour"
          subtitle="Mentorship, job shadows, and portfolio reviews — no wage, no credit, no board interview"
          action={<OfferMentorship topicVocabulary={topicVocabulary} />}
        />
        {mentorshipOffers.length === 0 ? (
          <div className="px-6 py-5">
            <p className="text-sm text-ink-600 max-w-2xl">
              Every other way of taking part on this page asks you to supervise
              somebody. This one asks for an hour of your time and nothing else —{" "}
              {organizationName(market.collegeIds[0])} handles the introduction, and
              students across {market.name} see who is offering. You can pause it
              whenever the quarter gets busy.
            </p>
            <Empty>You haven&rsquo;t offered to mentor anyone yet.</Empty>
          </div>
        ) : (
          <ul className="row-list divide-y divide-line">
            {mentorshipOffers.map((offer) => (
              <li key={offer.id} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-ink-950">
                        {offer.mentorName}
                      </span>
                      <span className="text-xs text-ink-500">{offer.mentorRole}</span>
                      <Badge tone="brand">{mentorshipFormatLabel(offer.format)}</Badge>
                      {/* Paused says so plainly. An employer who cannot tell a
                          paused offer from a live one will assume the silence
                          means nobody wanted them. */}
                      {offer.status === "paused" && (
                        <Badge tone="warn">Paused — students can&rsquo;t see this</Badge>
                      )}
                    </div>
                    <p className="text-xs text-ink-600 mt-1 max-w-xl">
                      {offer.description}
                    </p>
                    <p className="text-xs text-ink-500 mt-1">
                      Up to {offer.capacity} student{offer.capacity === 1 ? "" : "s"} at
                      once
                      {offer.topics.length > 0 && ` · ${offer.topics.join(" · ")}`}
                    </p>
                  </div>
                  <TransitionActions
                    id={offer.id}
                    action={mentorshipLifecycleAsBusiness}
                    subject={`${offer.mentorName} — ${mentorshipFormatLabel(offer.format)}`}
                    confirm={MENTORSHIP_CONFIRM}
                    transitions={mentorshipMachine
                      .available(actor, { offer })
                      .map((t) => ({ to: t.to, label: t.label }))}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="px-6 pb-5">
          <Assumption>
            Mentorship carries no credit and no reimbursement, so nothing here goes to
            the college for review — there is no academic claim to underwrite. Who
            starts a pairing is unsettled (Q22), so the introduction still happens
            off-platform through {organizationName(market.collegeIds[0])}.
          </Assumption>
        </div>
      </Card>
      </div>
      </PageSection>
    </div>
  );
}
