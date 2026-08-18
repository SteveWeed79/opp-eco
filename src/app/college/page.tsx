import Link from "next/link";
import { Award, FileEdit, HandHeart, PenLine, UserCheck } from "lucide-react";
import {
  Assumption,
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  PageHeader,
  PageSection,
  ProgressBar,
  Stat,
  TrackBadge,
} from "@/components/ui";
import { repositories, organizationName } from "@/data/memory";
import { actorForPortal, getActor } from "@/auth/session";
import { unreviewedWeeksByApplication } from "@/services/timesheet";
import { marketRemainingBudget, studentCreditProgress } from "@/lib/queries";
import { isSelfSufficientForCredit } from "@/domain/credit";
import { availableTransitions, isTerminal } from "@/domain/workflow";
import { postingMachine, studentMachine } from "@/domain/lifecycle";
import { mentorshipFormatLabel } from "@/domain/mentorship";
import {
  postingLifecycleAsCollege,
  studentLifecycle,
} from "@/app/_actions/lifecycle";
import { postingTotalHours, type Posting } from "@/domain/types";
import {
  TransitionActions,
  POSTING_CONFIRM,
  STUDENT_CONFIRM,
} from "@/components/TransitionActions";
import { platformTheme } from "@/theme/theme";
import { collegeTransition } from "./actions";
import { ThemeChecker } from "./ThemeChecker";
import { WeeklyRecord } from "./WeeklyRecord";

export default async function CollegePage() {
  const actor = await actorForPortal("college");
  // Whether there is a real session, as opposed to the signed-out demo
  // fallback this portal renders under. Only affects what is linkable.
  const signedIn = (await getActor()) !== null;
  const unreviewedWeeks = unreviewedWeeksByApplication(actor);
  const college = repositories.organizations.find(actor, actor.membership.organizationId!)!;
  const hoursPerCredit = college.hoursPerCredit ?? 45;
  const market = repositories.markets.find(actor, actor.membership.marketId!)!;
  // Part of the transition context. No college transition is budget-guarded,
  // but the state machine takes one context shape for every caller.
  const remainingBudget = marketRemainingBudget(actor, market);

  const pendingVerification = repositories.students.pendingVerification(actor);
  const needsDrafting = repositories.postings.awaitingCollegeHelp(actor);
  const pendingReview = repositories.postings.list(actor, { status: "pending_review" });
  const creditQueue = repositories.applications
    .list(actor)
    .filter((a) => a.status === "credit_pending");
  const granted = repositories.creditAwards
    .list(actor)
    .filter((c) => c.status === "granted");

  const activePlacements = repositories.applications
    .list(actor)
    .filter((a) => a.status === "placement_active");

  // The employers currently offering time. The college is told when one is
  // made and the message links here, so this is the page that has to show it.
  const mentors = repositories.mentorshipOffers.openInMarket(actor);

  /**
   * Publication moves the college may make on a posting right now.
   *
   * Read from the machine rather than written out per card: the close guard
   * counts live applications, so a posting with candidates in it must not
   * offer "Close" even though the transition exists.
   */
  const postingTransitionsFor = (posting: Posting) =>
    postingMachine
      .available(actor, {
        posting,
        openApplications: repositories.applications
          .forPosting(actor, posting.id)
          .filter((a) => !isTerminal(a.status)).length,
      })
      .map((t) => ({ to: t.to, label: t.label }));

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16 space-y-8">
      <PageHeader
        eyebrow="Education partner"
        title={college.name}
        subtitle="Local operator for the Southeast Kansas market"
        action={
          <div className="text-right">
            <p className="text-xs font-bold text-ink-500 uppercase tracking-wider">
              Credit policy
            </p>
            <p className="text-lg font-black text-brand-700 tabular">
              {hoursPerCredit} hrs / credit
            </p>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Awaiting verification"
          value={String(pendingVerification.length)}
          hint="Students cannot apply until verified"
          tone={pendingVerification.length > 0 ? "warn" : "good"}
        />
        <Stat
          label="Businesses needing help"
          value={String(needsDrafting.length)}
          hint="Asked you to scope a posting"
          tone={needsDrafting.length > 0 ? "warn" : "good"}
        />
        <Stat label="Interns placed" value={String(activePlacements.length)} tone="good" />
        <Stat
          label="Credits granted"
          value={String(granted.reduce((s, c) => s + c.creditHours, 0))}
          tone="brand"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Zone 1 — the queues. Everything the college is the only party who  */}
      {/* can clear, named as such so the page opens on work rather than on  */}
      {/* five cards of equal weight.                                        */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Needs you today"
        description="Every queue here is one only the college can clear — students cannot apply, postings cannot reach them, and credit cannot be awarded until you act."
      >
      <div className="grid gap-6 lg:grid-cols-2 items-start">
        {/* ---------------------------------------------------------------- */}
        {/* Roster verification — the trust gate                              */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader
            level={3}
            icon={<UserCheck className="w-5 h-5" />}
            title="Student verification"
            subtitle="Confirm enrollment and eligibility for internship credit"
          />
          {pendingVerification.length === 0 ? (
            <Empty>Every student on your roster is verified.</Empty>
          ) : (
            <ul className="row-list divide-y divide-line">
              {pendingVerification.map((student) => (
                <li
                  key={student.id}
                  className="px-6 py-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold text-sm text-ink-950">{student.name}</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {student.programOfStudy} · {student.classStanding} · graduating{" "}
                      {student.expectedGraduation}
                    </p>
                  </div>
                  <TransitionActions
                    id={student.id}
                    action={studentLifecycle}
                    subject={student.name}
                    confirm={STUDENT_CONFIRM}
                    transitions={studentMachine
                      .available(actor, { student })
                      .map((t) => ({ to: t.to, label: t.label }))}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Assisted drafting — the intermediary role                         */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader
            level={3}
            icon={<PenLine className="w-5 h-5" />}
            title="Businesses needing a hand"
            subtitle="They know they want an intern but not how to scope the work"
          />
          {needsDrafting.length === 0 ? (
            <Empty>No drafting requests waiting.</Empty>
          ) : (
            <ul className="row-list divide-y divide-line">
              {needsDrafting.map((posting) => (
                <li key={posting.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-ink-950">
                          {posting.title}
                        </span>
                        <TrackBadge track={posting.track} posting={posting} hoursPerCredit={hoursPerCredit} />
                      </div>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {organizationName(posting.businessId)} · {posting.county} County
                      </p>
                    </div>
                    <TransitionActions
                      id={posting.id}
                      action={postingLifecycleAsCollege}
                      subject={posting.title}
                      confirm={POSTING_CONFIRM}
                      transitions={postingTransitionsFor(posting)}
                    />
                  </div>
                  <p className="text-xs text-ink-600 mt-2 italic border-l-2 border-line-strong pl-3">
                    &ldquo;{posting.description}&rdquo;
                  </p>
                  {posting.skillsRequired.length === 0 && (
                    <p className="text-xs text-warn-700 mt-2 font-semibold">
                      No skills listed — this posting will not match anyone as written
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Posting review — the college gates what students see                */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          level={3}
          icon={<FileEdit className="w-5 h-5" />}
          title="Postings awaiting review"
          subtitle="Nothing reaches students until the college signs off"
        />
        {pendingReview.length === 0 ? (
          <Empty>No postings waiting for review.</Empty>
        ) : (
          <ul className="row-list divide-y divide-line">
            {pendingReview.map((posting) => {
              const totalHours = postingTotalHours(posting);
              const selfSufficient = isSelfSufficientForCredit(posting, hoursPerCredit);
              return (
                <li key={posting.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Publishing is a judgement about the work, so the
                            work is one click away rather than summarised in a
                            row.

                            Linked only for a genuinely signed-in reviewer. The
                            opportunity page treats a signed-out visitor as a
                            student, and a student cannot open an unpublished
                            posting — so offering the link while browsing the
                            demo signed out would be a link to a 404. The
                            description below is on the row either way. */}
                        {signedIn ? (
                          <Link
                            href={`/opportunities/${posting.id}`}
                            className="font-semibold text-ink-950 hover:text-brand-700 transition-colors"
                          >
                            {posting.title}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink-950">
                            {posting.title}
                          </span>
                        )}
                        <TrackBadge track={posting.track} posting={posting} hoursPerCredit={hoursPerCredit} />
                      </div>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {organizationName(posting.businessId)} · {totalHours} total hours
                      </p>
                      <p className="text-xs text-ink-600 mt-1.5 line-clamp-2 max-w-xl">
                        {posting.description}
                      </p>
                    </div>
                    <TransitionActions
                      id={posting.id}
                      action={postingLifecycleAsCollege}
                      subject={posting.title}
                      confirm={POSTING_CONFIRM}
                      transitions={postingTransitionsFor(posting)}
                    />
                  </div>
                  <div className="mt-3">
                    <Badge tone={selfSufficient ? "good" : "warn"}>
                      {selfSufficient
                        ? `Clears ${hoursPerCredit} hrs — credit-bearing on its own`
                        : `${totalHours} hrs — below your ${hoursPerCredit} hr threshold, must stack`}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Credit approval, including stacked micro-internships                */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          level={3}
          icon={<Award className="w-5 h-5" />}
          title="Credit approvals"
          subtitle="Standard placements stand alone; micro-internships arrive stacked"
        />
        {creditQueue.length === 0 ? (
          <Empty>No credit decisions waiting.</Empty>
        ) : (
          <ul className="row-list divide-y divide-line">
            {(() => {
              // Group by student, because banked micro work is awarded together
              const byStudent = new Map<string, typeof creditQueue>();
              for (const application of creditQueue) {
                const list = byStudent.get(application.studentId) ?? [];
                list.push(application);
                byStudent.set(application.studentId, list);
              }

              return Array.from(byStudent.entries()).map(([studentId, apps]) => {
                const student = repositories.students.find(actor, studentId)!;
                const progress = studentCreditProgress(actor, studentId, hoursPerCredit);
                const ready = progress.creditsAvailable >= 1;

                return (
                  <li key={studentId} className="px-6 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-ink-950">{student.name}</p>
                        <p className="text-xs text-ink-500 mt-0.5">
                          {student.programOfStudy} ·{" "}
                          {apps.length === 1
                            ? "1 completed placement"
                            : `${apps.length} completed micro-internships`}
                        </p>
                      </div>
                      {/* The aggregate award is deliberately not wired. It has
                          to decide which completed projects an award consumes
                          and where leftover hours go — the open stacking
                          question (Q21). Granting credit per placement below
                          works today and does not prejudge it. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled
                        title="Awarding across several placements at once depends on the credit-stacking rule (Q21), which is still open. Grant per placement below."
                      >
                        {ready
                          ? `${progress.creditsAvailable} credit available`
                          : "Below threshold"}
                      </Button>
                    </div>

                    <ul className="mt-3 space-y-1.5">
                      {apps.map((application) => {
                        const posting = repositories.postings.find(
                          actor,
                          application.postingId,
                        )!;
                        return (
                          <li
                            key={application.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-600"
                          >
                            <span className="flex items-center gap-2">
                              <TrackBadge track={application.track} posting={posting} hoursPerCredit={hoursPerCredit} />
                              {posting.title}
                            </span>
                            <span className="flex items-center gap-3">
                              <span className="tabular">
                                {application.track === "standard"
                                  ? `${application.hoursApproved} hrs approved`
                                  : `${postingTotalHours(posting)} hrs`}
                              </span>
                              {/* The work behind the number. A college
                                  awarding academic credit is making a
                                  judgement about what was done, not about how
                                  many hours were billed — so the weekly record
                                  the supervisor signed off is here rather than
                                  a total it has to take on trust. */}
                              {application.track === "standard" && (
                                <WeeklyRecord
                                  entries={repositories.timeEntries.forApplication(
                                    actor,
                                    application.id,
                                  )}
                                />
                              )}
                              {/* Per application, because that is what the
                                  domain models. The aggregate award across
                                  several placements is the open stacking
                                  question — see the note below the list. */}
                              <TransitionActions
                                id={application.id}
                                action={collegeTransition}
                                subject={`${student.name} — ${posting.title}`}
                                transitions={availableTransitions(actor, {
                                  application,
                                  student,
                                  remainingBudget,
                                  postingOwnerId: posting.businessId,
                                  unreviewedWeeks: unreviewedWeeks.get(application.id) ?? 0,
                                }).map((t) => ({ to: t.to, label: t.label }))}
                              />
                            </span>
                          </li>
                        );
                      })}
                    </ul>

                    {/* Only micro work banks hours; standard placements award
                        the credit their posting declared. */}
                    {progress.microApplicationIds.length > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-ink-500 mb-1">
                          <span>Micro hours banked toward next credit</span>
                          <span className="tabular">
                            {progress.bankedHours % hoursPerCredit} / {hoursPerCredit} hrs
                          </span>
                        </div>
                        <ProgressBar
                          value={progress.bankedHours % hoursPerCredit}
                          max={hoursPerCredit}
                      label={`${student.name} hours banked toward the next credit`}
                          tone={progress.microCredits > 0 ? "good" : "warn"}
                        />
                      </div>
                    )}
                    {progress.standardCredits > 0 && (
                      <p className="text-xs text-ink-500 mt-3">
                        {progress.standardCredits} credit
                        {progress.standardCredits === 1 ? "" : "s"} from completed
                        semester placements, as declared on the posting
                      </p>
                    )}
                  </li>
                );
              });
            })()}
          </ul>
        )}
        <div className="px-6 pb-5">
          <Assumption>
            {hoursPerCredit} hours per credit is your institution&rsquo;s configurable
            policy (Q11), enforced when a posting is published rather than discovered
            after the work is done.
          </Assumption>
        </div>
      </Card>

      </PageSection>

      {/* ------------------------------------------------------------------ */}
      {/* Zone 2 — the market the college operates, rather than work waiting  */}
      {/* on it. Mentors live here because the college is the party that makes */}
      {/* the introduction, and the notification it receives says so.         */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Your market"
        description="Nothing here is a queue. It is what the employers in this market are currently offering students."
      >
        <Card>
          <CardHeader
            level={3}
            icon={<HandHeart className="w-5 h-5" />}
            title="Employers offering to mentor"
            subtitle="No credit, no wage, no board clearance — an hour of somebody's time, and you are who introduces the student"
          />
          {mentors.length === 0 ? (
            <Empty>No employers are offering mentorship yet.</Empty>
          ) : (
            <ul className="row-list divide-y divide-line">
              {mentors.map((offer) => (
                <li
                  key={offer.id}
                  className="px-6 py-4 flex flex-wrap items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-ink-950">
                        {offer.mentorName}
                      </span>
                      <span className="text-xs text-ink-500">{offer.mentorRole}</span>
                      <Badge tone="brand">{mentorshipFormatLabel(offer.format)}</Badge>
                    </div>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {organizationName(offer.businessId)}
                    </p>
                    <p className="text-xs text-ink-600 mt-1 max-w-xl">
                      {offer.description}
                    </p>
                  </div>
                  <span className="text-xs text-ink-500 whitespace-nowrap">
                    Up to {offer.capacity} at once
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="px-6 pb-5">
            <Assumption>
              Who starts a pairing is unsettled (Q22), so this is a list to introduce
              students from rather than a queue to work. Nothing here records that a
              mentorship happened.
            </Assumption>
          </div>
        </Card>
      </PageSection>

      {/* ------------------------------------------------------------------ */}
      {/* Zone 3 — settings.                                                  */}
      {/*                                                                     */}
      {/* This used to be a seventh anonymous card stapled to the end of an   */}
      {/* operational page: the tallest thing on the screen, styled exactly   */}
      {/* like the queues above it, and touched roughly once a year. Recessed */}
      {/* behind a rule and a muted label, it stops competing with work — and */}
      {/* stays on this page rather than moving to a route of its own,        */}
      {/* because the contrast checker is a thing to be *shown*, and nobody   */}
      {/* clicks into settings during a walkthrough.                          */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Institution settings"
        description="Rarely changed. How this college appears to its own students."
        tone="settings"
      >
        <ThemeChecker
          initialBrand={college.brandColor ?? platformTheme().ramp[700]}
          initialAccent={college.accentColor}
          organizationName={college.name}
        />
      </PageSection>
    </div>
  );
}
