import Link from "next/link";
import {
  Award,
  Compass,
  FileEdit,
  ShieldCheck,
  HandHeart,
  PenLine,
  UserCheck,
} from "lucide-react";
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
import { repositories } from "@/data/backend";
import { nameLookups } from "@/lib/names";
import { actorForPortal, getActor } from "@/auth/session";
import { unreviewedWeeksByApplication } from "@/services/timesheet";
import {
  followUpQueue,
  marketFunding,
  studentCreditProgress,
} from "@/lib/queries";
import { isSelfSufficientForCredit } from "@/domain/credit";
import { availableTransitions, isTerminal } from "@/domain/workflow";
import { postingMachine, studentMachine } from "@/domain/lifecycle";
import { mentorshipFormatLabel, placesLeft } from "@/domain/mentorship";
import { OUTCOME_KINDS } from "@/domain/outcome";
import { CONSENT_GRANTORS, CONSENT_SCOPES, hasConsent } from "@/domain/consent";
import { RecordConsent } from "@/components/RecordConsent";
import { DEMO_NOW } from "@/data/seed";
import { IntroduceStudent } from "@/components/IntroduceStudent";
import { IntroductionOutcome } from "@/components/IntroductionOutcome";
import { RecordOutcome } from "@/components/RecordOutcome";
import {
  postingLifecycleAsCollege,
  studentLifecycle,
} from "@/app/_actions/lifecycle";
import { postingTotalHours, type MentorshipPairing, type Posting } from "@/domain/types";
import {
  TransitionActions,
  POSTING_CONFIRM,
  STUDENT_CONFIRM,
} from "@/components/TransitionActions";
import { platformTheme } from "@/theme/theme";
import {
  collegeCloseIntroduction,
  collegeIntroduceStudent,
  collegeRecordConsent,
  collegeRecordOutcome,
  collegeTransition,
} from "./actions";
import { ThemeChecker } from "./ThemeChecker";
import { WeeklyRecord } from "./WeeklyRecord";
import { opportunityPath } from "@/routes";

export default async function CollegePage() {
  const actor = await actorForPortal("college");
  const { organizationName } = await nameLookups(actor);
  // Whether there is a real session, as opposed to the signed-out demo
  // fallback this portal renders under. Only affects what is linkable.
  const signedIn = (await getActor()) !== null;
  const unreviewedWeeks = await unreviewedWeeksByApplication(actor);
  const college = (await repositories.organizations.find(actor, actor.membership.organizationId!))!;
  const hoursPerCredit = college.hoursPerCredit ?? 45;
  const market = (await repositories.markets.find(actor, actor.membership.marketId!))!;
  // Part of the transition context. No college transition is budget-guarded,
  // but the state machine takes one context shape for every caller.
  const remainingBudget = (await marketFunding(actor, market.id)).wage?.remaining ?? 0;

  const pendingVerification = await repositories.students.pendingVerification(actor);
  const needsDrafting = await repositories.postings.awaitingCollegeHelp(actor);
  const pendingReview = await repositories.postings.list(actor, { status: "pending_review" });
  const allApplications = await repositories.applications.list(actor);
  const creditQueue = allApplications.filter((a) => a.status === "credit_pending");
  const granted = (await repositories.creditAwards.list(actor)).filter(
    (c) => c.status === "granted",
  );
  const activePlacements = allApplications.filter(
    (a) => a.status === "placement_active",
  );

  /**
   * Finished experiences nobody has followed up on, longest wait first.
   *
   * A queue rather than a report, and it belongs in this zone for the same
   * reason verification does: nobody else can clear it. The employer does not
   * know where its intern went afterwards, the board's interest ended when it
   * reimbursed the placement, and the administrator is watching five markets.
   */
  const followUps = await followUpQueue(actor);

  /**
   * Learners this college has verified but has no education-record consent for.
   *
   * Exception-first, like every queue on this page. It is the college's to
   * clear because consent is a property of the institution whose records it
   * covers — and it has a visible consequence rather than being paperwork: an
   * employer sees an abbreviated name and no way to make contact until it is
   * on file, however far the placement has got.
   */
  const consentsOnFile = await repositories.consents.list(actor);
  const missingConsent = (await repositories.students.list(actor)).filter(
    (candidate) =>
      candidate.status === "verified" &&
      !candidate.purgedOn &&
      !hasConsent(
        consentsOnFile,
        {
          studentId: candidate.id,
          sourceOrgId: college.id,
          scope: "education_record",
        },
        DEMO_NOW,
      ),
  );

  // The employers currently offering time. The college is told when one is
  // made and the message links here, so this is the page that has to show it.
  const mentors = await repositories.mentorshipOffers.openInMarket(actor);

  // The introductions behind them. Without these the capacity on an offer is a
  // number nobody can check — which is exactly what this list used to show.
  const pairings = await repositories.mentorshipPairings.list(actor);
  const liveByOffer = new Map<string, MentorshipPairing[]>();
  for (const pairing of pairings) {
    liveByOffer.set(pairing.offerId, [
      ...(liveByOffer.get(pairing.offerId) ?? []),
      pairing,
    ]);
  }

  /**
   * Who the college can put in front of a mentor.
   *
   * Verified only, and that is the safeguarding rule rather than a filter for
   * tidiness: mentorship has no supervisor, no timesheet and no board
   * interview behind it, so the college's own verification is the only check
   * standing between an adult and a student.
   */
  const live = pairings.filter((p) => p.status === "introduced");
  // Resolved from the roster this page already read, rather than a second
  // query per row.
  const studentNames = new Map(
    (await repositories.students.list(actor)).map((s) => [s.id, s.name]),
  );
  const studentName = (id: string) => studentNames.get(id) ?? "A student";
  const mentorNames = new Map(mentors.map((offer) => [offer.id, offer.mentorName]));
  const mentorName = (offerId: string) => mentorNames.get(offerId) ?? "a mentor";

  const introducible = (await repositories.students.list(actor))
    .filter((student) => student.status === "verified")
    .map((student) => ({
      id: student.id,
      name: student.name,
      programOfStudy: student.programOfStudy,
      classStanding: student.classStanding,
    }));

  /**
   * Publication moves the college may make on a posting right now.
   *
   * Read from the machine rather than written out per card: the close guard
   * counts live applications, so a posting with candidates in it must not
   * offer "Close" even though the transition exists.
   */
  const openCounts = new Map<string, number>();
  for (const application of allApplications) {
    if (isTerminal(application.status)) continue;
    openCounts.set(
      application.postingId,
      (openCounts.get(application.postingId) ?? 0) + 1,
    );
  }

  const postingTransitionsFor = (posting: Posting) =>
    postingMachine
      .available(actor, {
        posting,
        openApplications: openCounts.get(posting.id) ?? 0,
      })
      .map((t) => ({ to: t.to, label: t.label }));

  /**
   * Everything the credit queue renders, resolved before it renders.
   *
   * The queue groups applications by student and then, per row, needs the
   * student, their banked-hours progress, each application's posting, and the
   * weekly record behind it. Left inline that is four awaits inside a nested
   * `.map`, which a component cannot do — and against Postgres it would be a
   * query per application per student.
   *
   * A flat student map is safe here in a way it would not be on the employer's
   * page: `forApplication` redacts only for a business, and the college owns
   * the student relationship outright.
   */
  const creditStudentIds = Array.from(new Set(creditQueue.map((a) => a.studentId)));
  const creditPostingIds = Array.from(new Set(creditQueue.map((a) => a.postingId)));
  const standardCreditIds = creditQueue
    .filter((a) => a.track === "standard")
    .map((a) => a.id);

  const [creditStudents, creditProgressList, creditPostings, creditEntries] =
    await Promise.all([
      Promise.all(creditStudentIds.map((id) => repositories.students.find(actor, id))),
      Promise.all(
        creditStudentIds.map((id) => studentCreditProgress(actor, id, hoursPerCredit)),
      ),
      Promise.all(creditPostingIds.map((id) => repositories.postings.find(actor, id))),
      Promise.all(
        standardCreditIds.map((id) =>
          repositories.timeEntries.forApplication(actor, id),
        ),
      ),
    ]);

  const creditStudentById = new Map(
    creditStudentIds.map((id, i) => [id, creditStudents[i]]),
  );
  const progressByStudent = new Map(
    creditStudentIds.map((id, i) => [id, creditProgressList[i]]),
  );
  const creditPostingById = new Map(
    creditPostingIds.map((id, i) => [id, creditPostings[i]]),
  );
  const entriesByApplication = new Map(
    standardCreditIds.map((id, i) => [id, creditEntries[i]]),
  );

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
                            href={opportunityPath(posting.id)}
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
                const student = creditStudentById.get(studentId)!;
                const progress = progressByStudent.get(studentId)!;
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
                        const posting = creditPostingById.get(application.postingId);
                        if (!posting) return null;
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
                                  entries={entriesByApplication.get(application.id) ?? []}
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

      {/* ------------------------------------------------------------------ */}
      {/* Consent — the paperwork that decides what an employer may see.      */}
      {/*                                                                     */}
      {/* Not a compliance chore bolted on the end: without an education-record */}
      {/* consent on file, an employer sees an abbreviated name and no way to  */}
      {/* reach the learner, however far the placement has got. The queue is   */}
      {/* the college's because consent is a property of the institution whose */}
      {/* records it covers, and no other party can assert it.                 */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          level={3}
          icon={<ShieldCheck className="w-5 h-5" />}
          title="Consent on file"
          subtitle="Verified learners whose records cannot yet be disclosed to an employer"
        />
        {missingConsent.length === 0 ? (
          <Empty>Every verified learner has an education-record consent on file.</Empty>
        ) : (
          <ul className="row-list divide-y divide-line">
            {missingConsent.map((learner) => (
              <li
                key={learner.id}
                className="px-6 py-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-sm text-ink-950">
                    {learner.name}
                  </span>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {learner.programOfStudy} · employers see an abbreviated name only
                  </p>
                </div>
                <RecordConsent
                  studentId={learner.id}
                  sourceOrgId={college.id}
                  learnerLabel={learner.name}
                  institutionName={college.name}
                  scopes={CONSENT_SCOPES.map((scope) => ({
                    value: scope.value,
                    label: scope.label,
                    meta: scope.meta,
                    description: scope.description,
                  }))}
                  grantors={CONSENT_GRANTORS.map((grantor) => ({
                    value: grantor.value,
                    label: grantor.label,
                    meta: grantor.meta,
                    description: "",
                  }))}
                  action={collegeRecordConsent}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="px-6 pb-5">
          <Assumption>
            Who had to sign is recorded rather than worked out. FERPA rights
            transfer at 18 or on enrolment at the college at any age, so a
            dual-credit learner may consent for themselves here while a parent
            still holds what their school knows — and no field on this screen
            can tell which applies.
          </Assumption>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Follow-up — the only measure of whether the venture worked.         */}
      {/*                                                                    */}
      {/* Everything above this card measures whether a placement worked.     */}
      {/* None of it answers the question a funder asks at the end of year    */}
      {/* three, which is whether the learner ended up working in this region */}
      {/* — and that answer takes a year of follow-ups, so the queue has to   */}
      {/* be worked long before anybody reads the total.                      */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          level={3}
          icon={<Compass className="w-5 h-5" />}
          title="Follow-up"
          subtitle="Finished experiences nobody has asked about yet — longest wait first"
        />
        {followUps.length === 0 ? (
          <Empty>Every finished placement has an outcome on record.</Empty>
        ) : (
          <ul className="row-list divide-y divide-line">
            {followUps.map(({ application, student, posting, days, window }) => (
              <li
                key={application.id}
                className="px-6 py-4 flex flex-wrap items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-ink-950">
                      {student.name}
                    </span>
                    <TrackBadge track={application.track} />
                  </div>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {posting.title} · {organizationName(posting.businessId)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {/* The quarter being asked about, not a countdown. A
                      placement that ended in February is measured in July, and
                      the arithmetic behind that is the product's job. */}
                  <Badge tone="brand">Covers {window.label}</Badge>
                  <span className="text-xs text-ink-500 whitespace-nowrap">
                    Finished {days} day{days === 1 ? "" : "s"} ago
                  </span>
                  <RecordOutcome
                    studentId={student.id}
                    applicationId={application.id}
                    studentName={student.name}
                    placementTitle={posting.title}
                    hostName={organizationName(posting.businessId)}
                    regionCounties={market.counties}
                    regionState={market.state}
                    choices={OUTCOME_KINDS.map((kind) => ({
                      value: kind.value,
                      label: kind.label,
                      meta: kind.meta,
                      description: kind.description,
                    }))}
                    action={collegeRecordOutcome}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="px-6 pb-5">
          <Assumption>
            Asked on a clock rather than whenever somebody gets round to it: the 2nd and 4th calendar quarter after the placement ended, which is the shape workforce reporting uses. A learner records their own and an employer answers what it decided; what is still open is nothing about who, and everything about what happens to a window that closes unanswered — it stays unanswered (Q23b).
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
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-xs text-ink-500 whitespace-nowrap">
                      {placesLeft(offer, liveByOffer.get(offer.id) ?? [])} of{" "}
                      {offer.capacity} place
                      {offer.capacity === 1 ? "" : "s"} free
                    </span>
                    <IntroduceStudent
                      offerId={offer.id}
                      mentorName={offer.mentorName}
                      employerName={organizationName(offer.businessId)}
                      formatLabel={mentorshipFormatLabel(offer.format)}
                      placesLeft={placesLeft(offer, liveByOffer.get(offer.id) ?? [])}
                      students={introducible.filter(
                        (student) =>
                          !(liveByOffer.get(offer.id) ?? []).some(
                            (p) =>
                              p.studentId === student.id && p.status === "introduced",
                          ),
                      )}
                      action={collegeIntroduceStudent}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* The introductions themselves. A place is spoken for until one of  */}
          {/* these is closed, so this is the part that has to be visible —     */}
          {/* an employer's capacity drains to nothing otherwise.               */}
          {live.length > 0 && (
            <div className="px-6 pb-2">
              {/* Every live one in this market, not only this college's — an
                  administrator can introduce too, and a college that could not
                  see those would double-book a mentor's last place. */}
              <h4 className="text-xs font-bold text-ink-500 uppercase tracking-widest mb-2">
                Introductions in flight
              </h4>
              <ul className="row-list divide-y divide-line border border-line rounded-card">
                {live.map((pairing) => (
                  <li
                    key={pairing.id}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-950">
                        {studentName(pairing.studentId)}
                      </p>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {mentorName(pairing.offerId)} ·{" "}
                        {organizationName(pairing.businessId)} · introduced{" "}
                        {new Date(pairing.introducedOn).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    <IntroductionOutcome
                      pairingId={pairing.id}
                      studentName={studentName(pairing.studentId)}
                      action={collegeCloseIntroduction}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="px-6 pb-5">
            <Assumption>
              The college and an administrator make introductions; a student cannot
              ask a mentor directly, because nothing else stands between an adult
              and a student here (Q22). Closing one records whether it happened and
              gives the mentor their place back.
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
      {/*                                                                     */}
      {/* Recessing it was not enough on its own: a form standing permanently */}
      {/* open still reads as work to do. It is now a summary row that opens  */}
      {/* the editor in a dialog, which keeps the palette and its findings on */}
      {/* the page — the part worth showing — without the inputs.             */}
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
