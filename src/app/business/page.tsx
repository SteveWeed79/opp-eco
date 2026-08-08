import { CircleDollarSign, HelpCircle, Plus, Users, Zap } from "lucide-react";
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
import { repositories, organizationName } from "@/data/memory";
import { actorForPortal } from "@/auth/session";
import { fundingCommitment, isTerminal } from "@/domain/workflow";
import { postingTotalHours } from "@/domain/types";

export default async function BusinessPage() {
  const actor = await actorForPortal("business");
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

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">
      <PageHeader
        dark
        eyebrow="Employer portal"
        title={org.name}
        subtitle={`${org.county} County · ${postings.filter((p) => p.status === "published").length} live postings`}
        action={
          <Button variant="primary">
            <span className="flex items-center gap-1.5">
              <Plus className="w-4 h-4" aria-hidden="true" /> Post an opportunity
            </span>
          </Button>
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
                        {application.status === "submitted" && (
                          <Button size="sm" variant="dark">
                            Review
                          </Button>
                        )}
                        {application.status === "under_review" && (
                          <Button size="sm" variant="primary">
                            Shortlist
                          </Button>
                        )}
                        {application.status === "placement_active" &&
                          application.track === "standard" && (
                            <Button size="sm" variant="ghost">
                              Approve hours
                            </Button>
                          )}
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
                      max={Math.max(3, repositories.applications.forPosting(actor, posting.id).length)}
                      tone="brand"
                    />
                    <p className="text-xs text-ink-500 mt-1">
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
    </div>
  );
}
