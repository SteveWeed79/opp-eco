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
  ProgressBar,
  Stat,
  StatusBadge,
  TableWrap,
  Td,
  Th,
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
import { repositories, organizationName } from "@/data/memory";
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
  const unreviewedWeeks = unreviewedWeeksByApplication(actor);
  const hoursQueue = reviewQueue(actor);
  const org = repositories.organizations.find(actor, actor.membership.organizationId!)!;
  const market = repositories.markets.find(actor, actor.membership.marketId!)!;
  const boardName = organizationName(market.boardId);
  const postings = repositories.postings.list(actor);
  const applications = repositories.applications
    .list(actor)
    .filter((a) => !isTerminal(a.status));

  const active = applications.filter((a) =>
    ["placement_active", "funding_authorized"].includes(a.status),
  );
  const reimbursed = active.reduce((sum, a) => sum + fundingCommitment(a), 0);
  const needsHelp = postings.filter((p) => p.status === "help_requested");
  // Part of the transition context every row needs. No employer transition is
  // budget-guarded today, but the state machine asks for it, and computing it
  // once here keeps it out of the row loop.
  const remainingBudget = marketRemainingBudget(actor, market);

  // Skills already in use across this market's postings, offered as the
  // vocabulary for a new one. Free-text tags sprawl into "JS", "Javascript",
  // and "JavaScript", and match scoring compares them literally.
  const skillVocabulary = Array.from(
    new Set(postings.flatMap((p) => [...p.skillsRequired, ...p.skillsPreferred])),
  ).sort();

  // This employer's own offers to mentor. Withdrawn ones are gone rather than
  // greyed out: the machine has no move away from withdrawn, so a row with no
  // buttons and no way back is a tombstone the employer cannot act on.
  const mentorshipOffers = repositories.mentorshipOffers
    .list(actor)
    .filter((o) => o.status !== "withdrawn");
  // Mentorship topics converge on the same vocabulary as posting skills, plus
  // whatever other mentors in this market already named. A separate free-text
  // field would sprawl into "UX", "UX design", and "User experience" exactly
  // the way skill tags do.
  const topicVocabulary = Array.from(
    new Set([
      ...skillVocabulary,
      ...repositories.mentorshipOffers.openInMarket(actor).flatMap((o) => o.topics),
      ...mentorshipOffers.flatMap((o) => o.topics),
    ]),
  ).sort();
  const college = repositories.organizations
    .list(actor, { kind: "college" })
    .find((o) => o.marketId === market.id);
  const hoursPerCredit = college?.hoursPerCredit ?? 45;

  /**
   * Live candidates against a posting — what the close guard reads, so the
   * button and the service agree about whether closing would strand anyone.
   */
  const openApplicationsFor = (postingId: string) =>
    repositories.applications
      .forPosting(actor, postingId)
      .filter((a) => !isTerminal(a.status)).length;

  const POSTING_LABEL: Record<string, string> = {
    draft: "Draft",
    help_requested: "With the college",
    college_drafting: "College drafting",
    pending_review: "Awaiting review",
    changes_requested: "Changes requested",
    published: "Live",
    filled: "Filled",
    closed: "Closed",
    expired: "Expired",
  };

  const POSTING_TONE: Record<string, "good" | "warn" | "brand" | "neutral"> = {
    published: "good",
    filled: "brand",
    changes_requested: "warn",
    pending_review: "warn",
    help_requested: "warn",
    college_drafting: "brand",
  };


  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">
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
            <span className="w-11 h-11 rounded-2xl bg-good-600 text-white flex items-center justify-center shrink-0">
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
        <Stat
          label="Awaiting your review"
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
      {/* Assisted drafting — a business that doesn't know how to scope work  */}
      {/* ------------------------------------------------------------------ */}
      {needsHelp.length > 0 && (
        <Card className="border-warn-100 ring-1 ring-warn-100">
          <CardHeader
            icon={<HelpCircle className="w-5 h-5 text-warn-600" />}
            title="Drafts you asked the college to help with"
            subtitle={`${organizationName(market.collegeIds[0])} will scope these into postings students can actually apply to`}
          />
          <ul className="divide-y divide-ink-100">
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
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Hours awaiting sign-off                                             */}
      {/*                                                                     */}
      {/* Above the pipeline deliberately. A student cannot be paid, cannot   */}
      {/* earn credit, and cannot have their placement closed out until these */}
      {/* are cleared, and the employer is the only party who can clear them. */}
      {/* ------------------------------------------------------------------ */}
      {hoursQueue.length > 0 && (
        <Card className="border-warn-100 ring-1 ring-warn-100">
          <CardHeader
            icon={<Clock className="w-5 h-5 text-warn-600" />}
            title="Hours awaiting your approval"
            subtitle="The board reimburses against these, and the college counts them toward credit"
          />
          <ul className="divide-y divide-ink-100">
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
                <p className="text-xs text-ink-600 mt-2 italic border-l-2 border-ink-200 pl-3">
                  &ldquo;{entry.summary}&rdquo;
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Candidate pipeline                                                  */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          icon={<Users className="w-5 h-5" />}
          title="Candidate pipeline"
          subtitle="Contact details unlock after board clearance"
        />
        {applications.length === 0 ? (
          <Empty>No candidates yet.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-ink-100">
                <tr>
                  <Th>Candidate</Th>
                  <Th>Opportunity</Th>
                  <Th>Match</Th>
                  <Th>State</Th>
                  <Th>Reimbursement</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {applications.map((application) => {
                  // Redacted at the repository, not in the markup — withheld
                  // fields never reach this page in the first place.
                  const student = repositories.students.forApplication(
                    actor,
                    application,
                  )!;
                  const posting = repositories.postings.find(
                    actor,
                    application.postingId,
                  )!;
                  const commitment = fundingCommitment(application);

                  return (
                    <tr key={application.id}>
                      <Td className="whitespace-nowrap">
                        <span className="font-semibold text-ink-950">{student.name}</span>
                        <span className="block text-xs text-ink-500">
                          {student.programOfStudy} · {student.classStanding}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap">{posting.title}</span>
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

      {/* ------------------------------------------------------------------ */}
      {/* Your postings, and where each one is                                */}
      {/*                                                                     */}
      {/* The college can send a posting back asking for a change. Without a  */}
      {/* surface where the employer sees that and can resubmit, "request     */}
      {/* changes" is a dead end that looks like a decision.                  */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          icon={<FileText className="w-5 h-5" />}
          title="Your postings"
          subtitle="Nothing reaches students until the college has reviewed it"
        />
        {postings.length === 0 ? (
          <Empty>No postings yet.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100">
            {postings.map((posting) => (
              <li key={posting.id} className="px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-ink-950">
                        {posting.title}
                      </span>
                      <TrackBadge
                        track={posting.track}
                        posting={posting}
                        hoursPerCredit={hoursPerCredit}
                      />
                      <Badge tone={POSTING_TONE[posting.status] ?? "neutral"}>
                        {POSTING_LABEL[posting.status] ?? posting.status}
                      </Badge>
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
      {/* Micro as the on-ramp — the working interview                        */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          icon={<Zap className="w-5 h-5 text-micro-600" />}
          title="Not ready for a full semester?"
          subtitle="Start with a project, see the work, then convert"
        />
        <div className="px-6 py-5 grid gap-6 md:grid-cols-2">
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
                      value={
                        repositories.applications.forPosting(actor, posting.id).length
                      }
                      label={`Interest in ${posting.title}`}
                      max={Math.max(3, repositories.applications.forPosting(actor, posting.id).length)}
                      tone="brand"
                    />
                    <p className="text-xs text-ink-600 mt-1">
                      {repositories.applications.forPosting(actor, posting.id).length}{" "}
                      interested
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
      {/* The bottom of the ladder — time, with nothing else attached         */}
      {/*                                                                     */}
      {/* Deliberately last. An employer who has scrolled past a semester of   */}
      {/* supervision and a fixed-fee project without saying yes to either is  */}
      {/* not short of interest, they are short of capacity — and this is the  */}
      {/* one thing on the page they can agree to without hiring anyone.      */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
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
          <ul className="divide-y divide-ink-100">
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
  );
}
