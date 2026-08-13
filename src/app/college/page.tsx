import { Award, FileEdit, PenLine, UserCheck } from "lucide-react";
import {
  Assumption,
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  PageHeader,
  ProgressBar,
  Stat,
  TrackBadge,
} from "@/components/ui";
import { repositories, organizationName } from "@/data/memory";
import { actorForPortal } from "@/auth/session";
import { marketRemainingBudget, studentCreditProgress } from "@/lib/queries";
import { isSelfSufficientForCredit } from "@/domain/credit";
import { availableTransitions } from "@/domain/workflow";
import { postingTotalHours } from "@/domain/types";
import { TransitionActions } from "@/components/TransitionActions";
import { platformTheme } from "@/theme/theme";
import { collegeTransition } from "./actions";
import { ThemeChecker } from "./ThemeChecker";

export default async function CollegePage() {
  const actor = await actorForPortal("college");
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

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------------------------------------------------------- */}
        {/* Roster verification — the trust gate                              */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <CardHeader
            icon={<UserCheck className="w-5 h-5" />}
            title="Student verification"
            subtitle="Confirm enrollment and eligibility for internship credit"
          />
          {pendingVerification.length === 0 ? (
            <Empty>Every student on your roster is verified.</Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
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
                  <Button size="sm" variant="primary">
                    Verify
                  </Button>
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
            icon={<PenLine className="w-5 h-5" />}
            title="Businesses needing a hand"
            subtitle="They know they want an intern but not how to scope the work"
          />
          {needsDrafting.length === 0 ? (
            <Empty>No drafting requests waiting.</Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
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
                    <Button size="sm" variant="dark">
                      Help draft
                    </Button>
                  </div>
                  <p className="text-xs text-ink-600 mt-2 italic border-l-2 border-ink-200 pl-3">
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
          icon={<FileEdit className="w-5 h-5" />}
          title="Postings awaiting review"
          subtitle="Nothing reaches students until the college signs off"
        />
        {pendingReview.length === 0 ? (
          <Empty>No postings waiting for review.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100">
            {pendingReview.map((posting) => {
              const totalHours = postingTotalHours(posting);
              const selfSufficient = isSelfSufficientForCredit(posting, hoursPerCredit);
              return (
                <li key={posting.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-ink-950">{posting.title}</span>
                        <TrackBadge track={posting.track} posting={posting} hoursPerCredit={hoursPerCredit} />
                      </div>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {organizationName(posting.businessId)} · {totalHours} total hours
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost">
                        Request changes
                      </Button>
                      <Button size="sm" variant="primary">
                        Publish
                      </Button>
                    </div>
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
          icon={<Award className="w-5 h-5" />}
          title="Credit approvals"
          subtitle="Standard placements stand alone; micro-internships arrive stacked"
        />
        {creditQueue.length === 0 ? (
          <Empty>No credit decisions waiting.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100">
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
                              {/* Per application, because that is what the
                                  domain models. The aggregate award across
                                  several placements is the open stacking
                                  question — see the note below the list. */}
                              <TransitionActions
                                applicationId={application.id}
                                action={collegeTransition}
                                subject={`${student.name} — ${posting.title}`}
                                transitions={availableTransitions(actor, {
                                  application,
                                  student,
                                  remainingBudget,
                                  postingOwnerId: posting.businessId,
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

      {/* ------------------------------------------------------------------ */}
      {/* Branding — what the college controls, and what it is told           */}
      {/* ------------------------------------------------------------------ */}
      <ThemeChecker
        initialBrand={college.brandColor ?? platformTheme().ramp[700]}
        initialAccent={college.accentColor}
        organizationName={college.name}
      />
    </div>
  );
}
