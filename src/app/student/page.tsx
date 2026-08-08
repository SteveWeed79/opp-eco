import {
  BadgeCheck,
  CalendarClock,
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
  ProgressBar,
  Stat,
  StatusBadge,
  TrackBadge,
} from "@/components/ui";
import { repositories, organizationName } from "@/data/memory";
import { actorForPortal } from "@/auth/session";
import { DEMO_NOW, studentForUser } from "@/data/seed";
import { marketRemainingBudget, studentCreditProgress } from "@/lib/queries";
import { availableTransitions, daysInStatus, isTerminal } from "@/domain/workflow";
import { explainScore, scoreMatch } from "@/domain/matching";
import { postingTotalHours } from "@/domain/types";
import { BookInterview } from "./BookInterview";

export default async function StudentPage() {
  const actor = await actorForPortal("student");
  // Resolved from the session rather than hardcoded.
  const student = studentForUser(actor.user.id)!;
  const STUDENT_ID = student.id;

  const applications = repositories.applications
    .forStudent(actor, STUDENT_ID)
    .filter((a) => !isTerminal(a.status));
  const openSlots = repositories.interviewSlots.open(actor);
  const college = repositories.organizations.find(actor, student.collegeId);
  const market = repositories.markets.find(actor, student.marketId)!;
  const progress = studentCreditProgress(actor, STUDENT_ID, college?.hoursPerCredit ?? 45);
  const remainingBudget = marketRemainingBudget(actor, market);
  const boardName = organizationName(market.boardId);

  // Opportunities the student hasn't applied to yet, best match first
  const applied = new Set(
    repositories.applications.forStudent(actor, STUDENT_ID).map((a) => a.postingId),
  );
  const recommended = repositories.postings
    .published(actor)
    .filter((p) => !applied.has(p.id))
    .map((posting) => ({
      posting,
      score: scoreMatch(student, posting, college?.county ?? "Crawford"),
    }))
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 4);

  // Only what the student can actually act on. An application waiting on the
  // business belongs in the list below, not in a card called "Needs you".
  const optionsFor = (application: (typeof applications)[number]) =>
    availableTransitions(actor, {
      application,
      student,
      remainingBudget,
      postingOwnerId:
        repositories.postings.find(actor, application.postingId)?.businessId ?? "",
    });

  const needsAction = applications.filter((a) => optionsFor(a).length > 0);

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">
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
        <Card className="border-warn-100 ring-1 ring-warn-100">
          <CardHeader
            icon={<CalendarClock className="w-5 h-5 text-warn-600" />}
            title="Needs you"
            subtitle="These stop moving until you act"
          />
          <ul className="divide-y divide-ink-100">
            {needsAction.map((application) => {
              const posting = repositories.postings.find(actor, application.postingId)!;
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
                      ratePerHour={market.subsidyRatePerHour}
                    />
                  )}

                  {options.length > 0 && !needsBoard && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {options.map((option) => (
                        <Button key={option.to} size="sm" variant="dark">
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader
              title="Active applications"
              subtitle={`${applications.length} in flight`}
            />
            {applications.length === 0 ? (
              <Empty>Nothing in flight. Browse opportunities to get started.</Empty>
            ) : (
              <ul className="divide-y divide-ink-100">
                {applications.map((application) => {
                  const posting = repositories.postings.find(
                    actor,
                    application.postingId,
                  )!;
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

          <Card>
            <CardHeader
              icon={<Sparkles className="w-5 h-5" />}
              title="Recommended for you"
              subtitle="Match scores sort your list — they never hide anything from an employer"
            />
            <ul className="divide-y divide-ink-100">
              {recommended.map(({ posting, score }) => (
                <li key={posting.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-ink-950">{posting.title}</span>
                        <TrackBadge track={posting.track} posting={posting} hoursPerCredit={college?.hoursPerCredit} />
                      </div>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {organizationName(posting.businessId)} · {posting.county} County
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
                        <Button size="sm" variant="primary">
                          Apply
                        </Button>
                      </div>
                    </div>
                  </div>
                  {score && score.factors.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-brand-600 font-semibold cursor-pointer">
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

        {/* ---------------------------------------------------------------- */}
        {/* Credit banking — the micro track's defining mechanic              */}
        {/* ---------------------------------------------------------------- */}
        <div className="space-y-6">
          <Stat
            label="Credits earned"
            value={String(
              repositories.creditAwards
                .forStudent(actor, STUDENT_ID)
                .filter((c) => c.status === "granted")
                .reduce((s, c) => s + c.creditHours, 0),
            )}
            hint="Verified by your college and the state"
            tone="good"
          />

          <Card>
            <CardHeader
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
    </div>
  );
}
