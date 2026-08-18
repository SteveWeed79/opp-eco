import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarClock, MapPin } from "lucide-react";
import {
  Assumption,
  Badge,
  Card,
  CardHeader,
  Money,
  PageHeader,
  PostingStatusBadge,
  TrackBadge,
} from "@/components/ui";
import { repositories, organizationName } from "@/data/memory";
import { viewerActor } from "@/auth/session";
import { isSelfSufficientForCredit } from "@/domain/credit";
import { canApply } from "@/domain/lifecycle";
import { postingTotalHours, type ActorContext, type Posting } from "@/domain/types";
import { pageTitle } from "@/brand";
import { ApplyButton } from "@/app/student/ApplyButton";

/**
 * One opportunity, in full.
 *
 * This exists because the description had nowhere to be read. A posting cannot
 * be published without one — the college's publish guard refuses an empty
 * description — and yet the only surfaces that rendered it were the employer's
 * own drafts and the college's drafting queue. Students, the people the
 * description is written for, were asked to apply to a title and a wage.
 *
 * A page rather than an expander, because an opportunity needs a URL. The
 * realistic path into this program is an advisor sending a student a link, and
 * until now there was no link to send.
 */

/**
 * What this actor may open, which is not the same for every role.
 *
 * The unpublished case needs its own rule rather than deferring to
 * `postings.find`. That accessor narrows by organization for `business` and by
 * market for everyone else — correct for the queues it was written for, and
 * too wide here: a student could open an employer's half-written draft by
 * guessing its id. Nothing exposed that before, because until this page there
 * was no way to address a posting by id at all.
 */
function visiblePosting(actor: ActorContext, id: string): Posting | null {
  // Published postings are the market's shopfront and every role in the market
  // may read one, including a business looking at a competitor's.
  const published = repositories.postings.published(actor).find((p) => p.id === id);
  if (published) return published;

  // Work in progress is visible only to the parties with a reason to see it:
  // the employer writing it, the college reviewing it, and the administrator.
  // A student or a board member gets the same answer as for an id that does
  // not exist, so the URL is not an oracle for what an employer is drafting.
  const { role, organizationId } = actor.membership;
  if (role !== "business" && role !== "college" && role !== "admin") return null;

  const posting = repositories.postings.find(actor, id);
  if (!posting) return null;
  // `find` already restricts a business to its own; re-asserted because this
  // is the line that would matter if that ever widened.
  if (role === "business" && posting.businessId !== organizationId) return null;

  return posting;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const actor = await viewerActor();
  const posting = visiblePosting(actor, id);

  // A forwarded link's preview is often all the context a second-hand reader
  // gets, so it names the role and the employer rather than the product.
  return {
    title: posting
      ? pageTitle(`${posting.title} — ${organizationName(posting.businessId)}`)
      : pageTitle("Opportunity"),
  };
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await viewerActor();
  const posting = visiblePosting(actor, id);
  if (!posting) notFound();

  const college = repositories.organizations
    .list(actor, { kind: "college" })
    .find((o) => o.marketId === posting.marketId);
  const hoursPerCredit = college?.hoursPerCredit ?? 45;
  const totalHours = postingTotalHours(posting);

  const student =
    actor.membership.role === "student"
      ? repositories.students.forUser(actor, actor.user.id)
      : null;
  const alreadyApplied = student
    ? repositories.applications
        .forStudent(actor, student.id)
        .some((a) => a.postingId === posting.id)
    : false;

  return (
    <div className="max-w-4xl mx-auto px-6 pt-8 pb-16 space-y-6">
      <Link
        href={actor.membership.role === "business" ? "/business" : "/student"}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-ink-950 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Back to your portal
      </Link>

      <PageHeader
        eyebrow="Opportunity"
        title={posting.title}
        subtitle={`${organizationName(posting.businessId)} · ${posting.county} County`}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TrackBadge
              track={posting.track}
              posting={posting}
              hoursPerCredit={hoursPerCredit}
            />
            {/* Anyone who can reach an unpublished posting is reviewing it, so
                the state is the first thing they need. Students only ever see
                published ones, so this stays out of their way. */}
            {posting.status !== "published" && (
              <PostingStatusBadge status={posting.status} />
            )}
          </div>
        }
      />

      <Card>
        <CardHeader
          icon={<Building2 className="w-5 h-5" />}
          title="What the work is"
          subtitle="Written by the employer, reviewed by the college before publication"
        />
        <div className="px-6 py-5 space-y-5">
          {/* `whitespace-pre-line` because employers write these in paragraphs
              and a description collapsed onto one line is the thing nobody
              reads. */}
          <p className="text-sm text-ink-700 whitespace-pre-line leading-relaxed">
            {posting.description}
          </p>

          {posting.track === "micro" && posting.deliverable && (
            <div>
              <h3 className="text-xs font-bold text-ink-700 uppercase tracking-wider mb-1.5">
                What you deliver
              </h3>
              <p className="text-sm text-ink-700">{posting.deliverable}</p>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-5">
            <SkillList label="Required" skills={posting.skillsRequired} required />
            <SkillList label="Nice to have" skills={posting.skillsPreferred} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<CalendarClock className="w-5 h-5" />}
          title="Terms"
          subtitle={
            posting.track === "standard"
              ? "Hourly, over a semester, with the board reimbursing the employer"
              : "A fixed fee for a scoped project — no board interview, no semester commitment"
          }
        />
        <dl className="px-6 py-5 grid sm:grid-cols-2 gap-x-6 gap-y-4">
          {posting.track === "standard" ? (
            <>
              <Term label="Wage">
                <Money value={posting.wagePerHour ?? 0} />
                /hour
              </Term>
              <Term label="Commitment">
                {posting.hoursPerWeek} hrs/week for {posting.weeks} weeks
              </Term>
              <Term label="Total hours">{totalHours}</Term>
              <Term label="Academic credit">{posting.creditHours} credits</Term>
              {posting.supervisorName && (
                <Term label="Supervisor">{posting.supervisorName}</Term>
              )}
            </>
          ) : (
            <>
              <Term label="Project fee">
                <Money value={posting.projectFee ?? 0} />
              </Term>
              <Term label="Estimated hours">{posting.estimatedHours}</Term>
              <Term label="Due within">{posting.dueWithinDays} days</Term>
            </>
          )}
          <Term label="Openings">{posting.openings}</Term>
          <Term label="Location">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-ink-400" aria-hidden="true" />
              {posting.county} County
            </span>
          </Term>
        </dl>

        <div className="px-6 pb-5">
          {/* The number that decides whether this alone earns credit, stated
              where a student is deciding rather than discovered afterwards. */}
          <Badge tone={isSelfSufficientForCredit(posting, hoursPerCredit) ? "good" : "warn"}>
            {isSelfSufficientForCredit(posting, hoursPerCredit)
              ? `${totalHours} hrs clears ${college?.name ?? "your college"}'s ${hoursPerCredit} hr threshold — credit-bearing on its own`
              : `${totalHours} hrs is below the ${hoursPerCredit} hr threshold — stacks with other work toward a credit`}
          </Badge>
        </div>
      </Card>

      {posting.status === "published" && student && (
        <Card>
          <div className="px-6 py-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-bold text-ink-950">
                {alreadyApplied
                  ? "You have applied to this"
                  : canApply(student)
                    ? "Interested?"
                    : "Not open to you yet"}
              </p>
              <p className="text-sm text-ink-500 mt-0.5 max-w-lg">
                {alreadyApplied
                  ? "The employer has your application. You will hear from us when they respond."
                  : canApply(student)
                    ? "Applying tells the employer you are interested. Nothing is committed until both sides agree."
                    : `${organizationName(student.collegeId)} has not verified your enrollment yet. Applications open once they do.`}
              </p>
            </div>
            {!alreadyApplied && canApply(student) && (
              <ApplyButton postingId={posting.id} title={posting.title} />
            )}
          </div>
        </Card>
      )}

      <Assumption>
        The description is the employer&rsquo;s own words. Attaching a job
        description document for download is not built — the upload pipeline
        exists but every file in it is scoped to a student, and a posting&rsquo;s
        attachment needs its own access rule.
      </Assumption>
    </div>
  );
}

function SkillList({
  label,
  skills,
  required,
}: {
  label: string;
  skills: string[];
  required?: boolean;
}) {
  return (
    <div>
      <h3 className="text-xs font-bold text-ink-700 uppercase tracking-wider mb-2">
        {label}
      </h3>
      {skills.length === 0 ? (
        <p className="text-sm text-ink-500">None listed.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <li key={skill}>
              <Badge tone={required ? "brand" : "neutral"}>{skill}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold text-ink-500 uppercase tracking-wider">
        {label}
      </dt>
      <dd className="text-sm text-ink-950 font-semibold mt-0.5">{children}</dd>
    </div>
  );
}
