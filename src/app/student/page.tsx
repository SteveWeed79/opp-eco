import Link from "next/link";
import {
  BadgeCheck,
  CalendarClock,
  Clock,
  HandHeart,
  Layers,
  Sparkles,
  TrendingUp,
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
  ProgressBar,
  Stat,
  StatusBadge,
  ToneCard,
  TrackBadge,
} from "@/components/ui";
import { repositories } from "@/data/backend";
import { nameLookups } from "@/lib/names";
import { actorForPortal } from "@/auth/session";
import { unreviewedWeeksByApplication } from "@/services/timesheet";
import { openWeeksFor } from "@/domain/timesheet";
import { DEMO_NOW, studentForUser } from "@/data/seed";
import { LogHours } from "./LogHours";
import { marketRemainingBudget, studentCreditProgress } from "@/lib/queries";
import { availableTransitions, daysInStatus, isTerminal } from "@/domain/workflow";
import { explainScore, scoreMatch } from "@/domain/matching";
import { mentorshipFormatLabel } from "@/domain/mentorship";
import { postingTotalHours } from "@/domain/types";
import { BookInterview } from "./BookInterview";
import { TransitionActions } from "@/components/TransitionActions";
import { ApplyButton } from "./ApplyButton";
import { studentTransition } from "./actions";

export default async function StudentPage() {
  const actor = await actorForPortal("student");
  const { organizationName } = await nameLookups(actor);
  const unreviewedWeeks = await unreviewedWeeksByApplication(actor);
  // Resolved from the session rather than hardcoded.
  const student = studentForUser(actor.user.id)!;
  const STUDENT_ID = student.id;

  const [ownApplications, openSlots, college, market, published] = await Promise.all([
    await repositories.applications.forStudent(actor, STUDENT_ID),
    await repositories.interviewSlots.open(actor),
    await repositories.organizations.find(actor, student.collegeId),
    await repositories.markets.find(actor, student.marketId),
    await repositories.postings.published(actor),
  ]);
  const applications = ownApplications.filter((a) => !isTerminal(a.status));
  const [progress, remainingBudget] = await Promise.all([
    studentCreditProgress(actor, STUDENT_ID, college?.hoursPerCredit ?? 45),
    marketRemainingBudget(actor, market!),
  ]);
  const boardName = organizationName(market!.boardId);

  // Timesheets for placements currently running. Only the standard track has
  // one — a micro project is bought as a deliverable for a fixed fee.
  //
  // Every posting and week these rows need, resolved before the render. A
  // student sees only their own applications, so this is a handful of rows,
  // but the shape matters: awaiting inside `.map` is not something a component
  // can do, and one query per placement is one too many.
  const timesheets = (
    await Promise.all(
      applications
        .filter((a) => a.status === "placement_active" && a.track === "standard")
        .map(async (application) => ({
          application,
          posting: (await repositories.postings.find(actor, application.postingId))!,
          entries: await repositories.timeEntries.forApplication(actor, application.id),
        })),
    )
  )
    .map((row) => ({
      ...row,
      openWeeks: openWeeksFor(
        new Date(row.application.statusSince),
        DEMO_NOW,
        row.entries,
      ),
    }));

  // Opportunities the student hasn't applied to yet, best match first
  const creditsEarned = (await repositories.creditAwards.forStudent(actor, STUDENT_ID))
    .filter((c) => c.status === "granted")
    .reduce((sum, c) => sum + c.creditHours, 0);

  const applied = new Set(ownApplications.map((a) => a.postingId));
  const recommended = published
    .filter((p) => !applied.has(p.id))
    .map((posting) => ({
      posting,
      score: scoreMatch(student, posting, college?.county ?? "Crawford"),
    }))
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 4);

  // Only what the student can actually act on. An application waiting on the
  // business belongs in the list below, not in a card called "Needs you".
  const ownPostings = await Promise.all(
    Array.from(new Set(applications.map((a) => a.postingId))).map((id) =>
      repositories.postings.find(actor, id),
    ),
  );
  const postingById = new Map(
    ownPostings.filter((p) => p !== null).map((p) => [p.id, p]),
  );

  const optionsFor = (application: (typeof applications)[number]) =>
    availableTransitions(actor, {
      application,
      student,
      remainingBudget,
      postingOwnerId: postingById.get(application.postingId)?.businessId ?? "",
      unreviewedWeeks: unreviewedWeeks.get(application.id) ?? 0,
    });

  const needsAction = applications.filter((a) => optionsFor(a).length > 0);

  // Employers offering time rather than a placement. Paused and withdrawn
  // offers are absent by the repository's definition of "open", so a mentor
  // mid-installation is not someone the student is invited to ask for.
  const mentors = await repositories.mentorshipOffers.openInMarket(actor);

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16 space-y-8">
      <PageHeader
        eyebrow="Student portal"
        title={`Welcome back, ${student.name.split(" ")[0]}`}
        subtitle={`${student.programOfStudy} · ${student.classStanding} · ${college?.name}`}
        action={<Button variant="primary">Update profile</Button>}
      />

      <div className="flex flex-wrap gap-3">
        <Badge tone="good" icon={<BadgeCheck className="w-3.5 h-3.5" />}>
          Verified by {college?.name}
        </Badge>
        {/* Clearance is per job, so a prior determination is history rather
            than a credential the student carries into a new application. */}
        {student.eligibility === "eligible" && (
          <Badge tone="neutral" icon={<BadgeCheck className="w-3.5 h-3.5" />}>
            Last board determination: eligible ·{" "}
            {new Date(student.eligibilityDeterminedOn!).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </Badge>
        )}
        {student.eligibility === "not_eligible" && (
          <Badge tone="warn">
            Not eligible for workforce funding — placements proceed unsubsidised
          </Badge>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The pause — surfaced the instant it opens, with slots inline        */}
      {/* ------------------------------------------------------------------ */}
      {needsAction.length > 0 && (
        <ToneCard tone="warn" elevation="floating">
          <CardHeader
            icon={<CalendarClock className="w-5 h-5 text-warn-600" />}
            title="Needs you"
            subtitle="These stop moving until you act"
          />
          <ul className="row-list divide-y divide-line">
            {needsAction.map((application) => {
              const posting = postingById.get(application.postingId)!;
              const days = daysInStatus(application, DEMO_NOW);
              const options = optionsFor(application);
              // Show the booking panel only when booking is a move the state
              // machine will actually accept — a student the board found
              // ineligible must not be offered slots for a refused action.
              const needsBoard = options.some((t) => t.to === "interview_scheduled");

              return (
                <li key={application.id} className="px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-ink-950">{posting.title}</h3>
                        <TrackBadge track={application.track} posting={posting} hoursPerCredit={college?.hoursPerCredit} />
                      </div>
                      <p className="text-sm text-ink-500 mt-0.5">
                        {organizationName(posting.businessId)} · {posting.county} County
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={application.status} />
                      {days >= 5 && (
                        <Badge tone={days >= 10 ? "crit" : "warn"}>
                          {days} days waiting
                        </Badge>
                      )}
                    </div>
                  </div>

                  {needsBoard && (
                    <BookInterview
                      applicationId={application.id}
                      slots={openSlots}
                      boardName={boardName}
                      ratePerHour={market!.subsidyRatePerHour}
                    />
                  )}

                  {options.length > 0 && !needsBoard && (
                    <div className="mt-4">
                      <TransitionActions
                        id={application.id}
                        action={studentTransition}
                        subject={posting.title}
                        transitions={options.map((o) => ({
                          to: o.to,
                          label: o.label,
                        }))}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </ToneCard>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Zone — what is already under way                                    */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Your placements"
        description="What you have in flight, the hours behind it, and what it is adding up to."
      >
      <div className="grid gap-8 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader
              level={3}
              title="Active applications"
              subtitle={`${applications.length} in flight`}
            />
            {applications.length === 0 ? (
              <Empty>Nothing in flight. Browse opportunities to get started.</Empty>
            ) : (
              <ul className="row-list divide-y divide-line">
                {applications.map((application) => {
                  const posting = postingById.get(application.postingId)!;
                  return (
                    <li key={application.id} className="px-6 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-ink-950">
                              {posting.title}
                            </span>
                            <TrackBadge track={application.track} posting={posting} hoursPerCredit={college?.hoursPerCredit} />
                          </div>
                          <p className="text-xs text-ink-500 mt-0.5">
                            {organizationName(posting.businessId)}
                            {posting.track === "standard"
                              ? ` · $${posting.wagePerHour}/hr · ${posting.hoursPerWeek} hrs/week`
                              : ` · $${posting.projectFee} project fee · ${posting.estimatedHours} hrs`}
                          </p>
                        </div>
                        <StatusBadge status={application.status} />
                      </div>
                      {application.status === "placement_active" &&
                        application.track === "standard" && (
                          <div className="mt-3">
                            <div className="flex justify-between text-xs text-ink-500 mb-1">
                              <span>Hours approved</span>
                              <span className="tabular">
                                {application.hoursApproved} of{" "}
                                {postingTotalHours(posting)}
                              </span>
                            </div>
                            <ProgressBar
                              value={application.hoursApproved ?? 0}
                              max={postingTotalHours(posting)}
                      label="Hours approved"
                              tone="good"
                            />
                          </div>
                        )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* -------------------------------------------------------------- */}
          {/* The week, logged. Until this existed the lifecycle dead-ended   */}
          {/* here: `placement_completed` has always required approved hours  */}
          {/* and nothing in the product could produce them.                  */}
          {/* -------------------------------------------------------------- */}
          {timesheets.length > 0 && (
            <Card>
              <CardHeader
                level={3}
                icon={<Clock className="w-5 h-5" />}
                title="Log your hours"
                subtitle="Your supervisor approves each week before it counts toward credit"
              />
              {timesheets.map(({ application, posting, entries, openWeeks }) => (
                <div key={application.id}>
                  <p className="px-6 pt-4 text-sm font-semibold text-ink-950">
                    {posting.title}
                    <span className="font-normal text-ink-500">
                      {" · "}
                      {organizationName(posting.businessId)}
                    </span>
                  </p>
                  <LogHours
                    applicationId={application.id}
                    postingTitle={organizationName(posting.businessId)}
                    entries={entries}
                    openWeeks={openWeeks}
                  />
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Credit banking — the micro track's defining mechanic              */}
        {/* ---------------------------------------------------------------- */}
        <div className="space-y-6">
          <Stat
            label="Credits earned"
            value={String(creditsEarned)}
            hint="Verified by your college and the state"
            tone="good"
          />

          <Card>
            <CardHeader
              level={3}
              icon={<Layers className="w-5 h-5" />}
              title="Credit bank"
              subtitle="Micro-internships stack until they reach a credit"
            />
            <div className="px-6 py-5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm text-ink-600">Banked hours</span>
                <span className="text-2xl font-black text-ink-950 tabular">
                  {progress.bankedHours}
                  <span className="text-sm font-normal text-ink-500">
                    {" "}
                    / {progress.hoursPerCredit}
                  </span>
                </span>
              </div>
              <ProgressBar
                value={progress.bankedHours % progress.hoursPerCredit}
                max={progress.hoursPerCredit}
                      label="Micro-internship hours banked toward the next credit"
                tone={progress.microCredits > 0 ? "good" : "brand"}
              />
              <p className="text-xs text-ink-500 mt-2">
                {progress.microCredits > 0
                  ? `${progress.microCredits} credit ready to claim`
                  : `${progress.hoursToNextCredit} more hours to your next credit`}
              </p>
              <Assumption>
                A single micro-internship runs 5–40 hours, short of the ~45 needed for one
                credit, so they stack (Q21). Change that and this panel changes with it.
              </Assumption>
            </div>
          </Card>

          <Card>
            <CardHeader
              level={3}
              icon={<TrendingUp className="w-5 h-5" />}
              title="Your skills"
              subtitle="What employers match against"
            />
            <div className="px-6 py-5 flex flex-wrap gap-2">
              {student.skills.map((skill: string) => (
                <Badge key={skill}>{skill}</Badge>
              ))}
            </div>
          </Card>
        </div>
      </div>
      </PageSection>

      {/* ------------------------------------------------------------------ */}
      {/* Zone — browsing, as opposed to the work already under way.          */}
      {/*                                                                     */}
      {/* Recommendations and mentors are the same act from the student's     */}
      {/* side: looking at what this market has for them. Split across a      */}
      {/* column boundary they were 1,300px apart, with mentors last in a     */}
      {/* sidebar that had already run out — so the smallest, least           */}
      {/* intimidating thing on the page was the hardest to find.             */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Explore"
        description="Opportunities matched to your profile, and employers offering time without an application."
      >
        <div className="grid gap-6 lg:grid-cols-3 items-start">
          <div className="lg:col-span-2">
          <Card>
            <CardHeader
              level={3}
              icon={<Sparkles className="w-5 h-5" />}
              title="Recommended for you"
              subtitle="Match scores sort your list — they never hide anything from an employer"
            />
            <ul className="row-list divide-y divide-line">
              {recommended.map(({ posting, score }) => (
                <li key={posting.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* The title is the link. Applying is a decision, and
                            until this existed a student made it from a title
                            and a wage — the description the college refuses to
                            publish without was rendered to nobody. */}
                        <Link
                          href={`/opportunities/${posting.id}`}
                          className="font-semibold text-ink-950 hover:text-brand-700 transition-colors"
                        >
                          {posting.title}
                        </Link>
                        <TrackBadge track={posting.track} posting={posting} hoursPerCredit={college?.hoursPerCredit} />
                      </div>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {organizationName(posting.businessId)} · {posting.county} County
                      </p>
                      {/* Clamped rather than truncated with a string slice, so
                          the full text is in the DOM for a screen reader and
                          the cut lands on a line rather than mid-word. */}
                      <p className="text-xs text-ink-600 mt-1.5 line-clamp-2 max-w-xl">
                        {posting.description}
                      </p>
                      <p className="text-xs text-ink-600 mt-1.5">
                        {posting.track === "standard" ? (
                          <>
                            <Money value={posting.wagePerHour ?? 0} />
                            /hr · {posting.hoursPerWeek} hrs/week · {posting.creditHours}{" "}
                            credits
                          </>
                        ) : (
                          <>
                            <Money value={posting.projectFee ?? 0} /> fixed fee ·{" "}
                            {posting.estimatedHours} hrs · due in {posting.dueWithinDays}{" "}
                            days
                          </>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      {score && (
                        <Badge tone={score.score >= 85 ? "good" : "brand"}>
                          {score.score}% match
                        </Badge>
                      )}
                      <div className="mt-2">
                        <ApplyButton postingId={posting.id} title={posting.title} />
                      </div>
                    </div>
                  </div>
                  {score && score.factors.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-brand-700 font-semibold cursor-pointer">
                        Why this score?
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {explainScore(score).map((line) => (
                          <li key={line} className="text-xs text-ink-500">
                            {line}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          </div>
          <div>
          {/* -------------------------------------------------------------- */}
          {/* Employers offering time rather than a placement                 */}
          {/*                                                                 */}
          {/* Read-only, and no "request" button, because there is no pairing */}
          {/* record behind it — the college makes the introduction. A button */}
          {/* that submitted nothing would be worse than the sentence saying  */}
          {/* who to ask.                                                     */}
          {/* -------------------------------------------------------------- */}
          {mentors.length > 0 && (
            <Card>
              <CardHeader
                level={3}
                icon={<HandHeart className="w-5 h-5" />}
                title="Mentors in your market"
                subtitle="Employers offering time — no application, no credit"
              />
              <ul className="row-list divide-y divide-line">
                {mentors.map((offer) => (
                  <li key={offer.id} className="px-6 py-4">
                    <p className="font-semibold text-sm text-ink-950">
                      {offer.mentorName}
                      <span className="font-normal text-ink-500">
                        {" · "}
                        {offer.mentorRole}
                      </span>
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {organizationName(offer.businessId)}
                    </p>
                    <div className="mt-2">
                      <Badge tone="brand">{mentorshipFormatLabel(offer.format)}</Badge>
                    </div>
                    <p className="text-xs text-ink-600 mt-2">{offer.description}</p>
                  </li>
                ))}
              </ul>
              <p className="px-6 pb-5 text-xs text-ink-500">
                Ask {college?.name ?? "your college"} to introduce you. None of these
                affect your applications or your credit.
              </p>
            </Card>
          )}
          </div>
        </div>
      </PageSection>
    </div>
  );
}
