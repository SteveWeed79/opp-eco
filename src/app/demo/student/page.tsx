import Link from "next/link";
import {
  BadgeCheck,
  CalendarClock,
  Clock,
  Compass,
  HandHeart,
  Layers,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
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
import { currentRegion } from "@/domain/region";
import { nameLookups } from "@/lib/names";
import { actorForPortal } from "@/auth/session";
import { unreviewedWeeksByApplication } from "@/services/timesheet";
import { openWeeksFor } from "@/domain/timesheet";
import { asOf } from "@/lib/clock";
import { LogHours } from "./LogHours";
import { followUpQueue, marketFunding, studentCreditProgress } from "@/lib/queries";
import { availableTransitions, daysInStatus, isTerminal } from "@/domain/workflow";
import { explainScore, scoreMatch } from "@/domain/matching";
import { mentorshipFormatLabel } from "@/domain/mentorship";
import { postingTotalHours } from "@/domain/types";
import { BookInterview } from "./BookInterview";
import { TransitionActions } from "@/components/TransitionActions";
import { ApplyButton } from "./ApplyButton";
import {
  saveProfile,
  studentHandInWork,
  studentRaiseProblem,
  studentRecordOwnOutcome,
  studentTransition,
} from "./actions";
import { RecordOutcome } from "@/components/RecordOutcome";
import { RaiseProblem } from "@/components/RaiseProblem";
import { HandInWork } from "@/components/HandInWork";
import { OUTCOME_KINDS } from "@/domain/outcome";
import { EditProfile } from "./EditProfile";
import { opportunityPath } from "@/routes";

export default async function StudentPage() {
  const actor = await actorForPortal("student");
  // Frozen for the demonstration, real for a real programme — see `asOf`.
  const now = await asOf(actor);
  const { organizationName } = await nameLookups(actor);
  const unreviewedWeeks = await unreviewedWeeksByApplication(actor);
  // Through the repository, not the fixtures.
  //
  // This read `studentForUser` out of `seed.ts` directly — the one place in the
  // application that reached around the repository contract. On the fixtures
  // the two are the same object, so nothing showed; on Postgres the portal
  // rendered the seeded learner's programme, hours, skills and eligibility
  // whatever the database held, and a learner editing their own profile saved
  // to the database and watched the page keep showing the old values.
  const student = (await repositories.students.forUser(actor, actor.user.id))!;
  const STUDENT_ID = student.id;

  const [ownApplications, openSlots, college, market, published] = await Promise.all([
    await repositories.applications.forStudent(actor, STUDENT_ID),
    await repositories.interviewSlots.open(actor),
    await repositories.organizations.find(actor, student.collegeId),
    await repositories.markets.find(actor, student.marketId),
    await repositories.postings.published(actor),
  ]);
  const applications = ownApplications.filter((a) => !isTerminal(a.status));
  // The micro track's hand-ins, keyed by placement. At most one per
  // application — the unique index says so — and a resubmission is a new round
  // on the same row rather than a second one.
  const handIns = new Map(
    (await repositories.deliverables.list(actor)).map((d) => [d.applicationId, d]),
  );
  // The vocabulary this market's employers already use, offered when a learner
  // edits their own tags. Free text sprawls into "JS", "Javascript" and
  // "JavaScript", and match scoring compares them literally — so the fix is the
  // same on both sides of the match.
  const skillVocabulary = Array.from(
    new Set(published.flatMap((p) => [...p.skillsRequired, ...p.skillsPreferred])),
  ).sort();
  const region = currentRegion(
    await repositories.regionDefinitions.forMarket(actor, student.marketId),
    student.marketId,
    now,
  );
  const [progress, funding, followUps] = await Promise.all([
    studentCreditProgress(actor, STUDENT_ID, college?.hoursPerCredit ?? 45),
    marketFunding(actor, market!.id),
    followUpQueue(actor),
  ]);
  const remainingBudget = funding.wage?.remaining ?? 0;
  const ratePerHour = funding.wage?.source.ratePerHour ?? 0;
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
        now,
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
  const mentorById = new Map(mentors.map((offer) => [offer.id, offer]));
  // Their own introductions, live ones only: a mentorship that has run its
  // course is not something to chase.
  const introductions = (await repositories.mentorshipPairings.list(actor)).filter(
    (pairing) => pairing.status === "introduced",
  );

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16 space-y-8">
      <PageHeader
        eyebrow="Student portal"
        title={`Welcome back, ${student.name.split(" ")[0]}`}
        subtitle={`${student.programOfStudy} · ${student.classStanding} · ${college?.name}`}
        action={
          <EditProfile
            profile={{
              programOfStudy: student.programOfStudy,
              classStanding: student.classStanding,
              expectedGraduation: student.expectedGraduation,
              skills: student.skills,
              interests: student.interests,
              availableHoursPerWeek: student.availableHoursPerWeek,
            }}
            skillVocabulary={skillVocabulary}
            collegeName={college?.name ?? "Your college"}
            action={saveProfile}
          />
        }
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
      {/* Where you went                                                      */}
      {/*                                                                     */}
      {/* Above the pause, and it blocks nothing — which is the argument for  */}
      {/* putting it here rather than at the bottom. A learner whose          */}
      {/* placement has finished has no other reason to open this page, so a  */}
      {/* card they have to scroll past everything to reach is a card nobody  */}
      {/* answers. It is also the cheapest way past a college officer         */}
      {/* phoning fourteen people who have left town.                         */}
      {/* ------------------------------------------------------------------ */}
      {followUps.length > 0 && (
        <Card>
          <CardHeader
            icon={<Compass className="w-5 h-5" />}
            title="Where did you land?"
            subtitle="Your placement has finished. Nobody has asked you yet — and your answer is worth more than anybody else's guess"
          />
          <ul className="row-list divide-y divide-line">
            {followUps.map(({ application, posting, days, window }) => (
              <li
                key={application.id}
                className="px-6 py-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-ink-950">{posting.title}</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {organizationName(posting.businessId)} · finished {days}{" "}
                    {days === 1 ? "day" : "days"} ago · asking about{" "}
                    {window.label}
                  </p>
                </div>
                <RecordOutcome
                  self
                  studentId={STUDENT_ID}
                  applicationId={application.id}
                  studentName={student.name}
                  placementTitle={posting.title}
                  hostName={organizationName(posting.businessId)}
                  regionCounties={region?.counties ?? []}
                  regionState={region?.state ?? ""}
                  choices={OUTCOME_KINDS}
                  action={studentRecordOwnOutcome}
                />
              </li>
            ))}
          </ul>
          <div className="px-6 pb-5">
          </div>
        </Card>
      )}

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
              const days = daysInStatus(application, now);
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
                      ratePerHour={ratePerHour}
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
                      {/*
                        The micro track's central act. Shown only while the
                        placement is running and only where the work is not
                        already accepted — after that the employer has it, and
                        the learner's next move is the credit rather than the
                        work.
                      */}
                      {application.track === "micro" &&
                        application.status === "placement_active" &&
                        handIns.get(application.id)?.status !== "submitted" && (
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <HandInWork
                              applicationId={application.id}
                              projectTitle={posting.title}
                              revisionAsked={
                                handIns.get(application.id)?.status === "revision_requested"
                                  ? handIns.get(application.id)?.response
                                  : undefined
                              }
                              round={handIns.get(application.id)?.round}
                              action={studentHandInWork}
                            />
                            {handIns.get(application.id)?.status === "revision_requested" && (
                              <Badge tone="warn">They asked for a change</Badge>
                            )}
                          </div>
                        )}
                      {application.track === "micro" &&
                        handIns.get(application.id)?.status === "submitted" && (
                          <p className="mt-3 text-xs text-ink-500">
                            Handed in — waiting on {organizationName(posting.businessId)}.
                          </p>
                        )}
                      {/*
                        Quiet, and last. Nobody should be nudged into reporting
                        a problem — a prominent control on a healthy placement
                        invites the noise that makes the administrator's queue
                        worthless — but a learner who needs it must not have to
                        go looking, and this is the only page they have.
                      */}
                      {!isTerminal(application.status) && (
                        <div className="mt-3">
                          <RaiseProblem
                            applicationId={application.id}
                            placementTitle={posting.title}
                            action={studentRaiseProblem}
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
                          href={opportunityPath(posting.id)}
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
          {/* Read-only, and no "request" button: the college or an           */}
          {/* administrator makes the introduction, because nothing else      */}
          {/* stands between an adult and a student on this form (Q22). What  */}
          {/* is new is that an introduction now leaves a record, so a student */}
          {/* can see they have one rather than wait on an email they may     */}
          {/* have missed.                                                    */}
          {/* -------------------------------------------------------------- */}
          {mentors.length > 0 && (
            <Card>
              <CardHeader
                level={3}
                icon={<HandHeart className="w-5 h-5" />}
                title="Mentors in your market"
                subtitle="Employers offering time — no application, no credit"
              />
              {introductions.length > 0 && (
                <div className="px-6 pt-4">
                  <div className="rounded-card border border-brand-200 bg-brand-50 px-4 py-3">
                    <h4 className="text-sm font-semibold text-ink-950">
                      {introductions.length === 1
                        ? "You have been introduced to a mentor"
                        : `You have been introduced to ${introductions.length} mentors`}
                    </h4>
                    <ul className="mt-1.5 space-y-1">
                      {introductions.map((pairing) => {
                        const offer = mentorById.get(pairing.offerId);
                        return (
                          <li key={pairing.id} className="text-xs text-ink-600">
                            <strong className="text-ink-950">
                              {offer?.mentorName ?? "A mentor"}
                            </strong>{" "}
                            at {organizationName(pairing.businessId)} — they are
                            expecting you to make contact.
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}

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
