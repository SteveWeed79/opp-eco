import { CalendarPlus, CircleDollarSign, ClipboardList, Wallet } from "lucide-react";
import {
  Assumption,
  Badge,
  Button,
  Card,
  CardHeader,
  DwellBadge,
  Empty,
  Money,
  PageHeader,
  ProgressBar,
  Stat,
  StatusBadge,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { repositories, organizationName } from "@/data/memory";
import { contextFor } from "@/data/session";
import { DEMO_NOW } from "@/data/seed";
import {
  availableTransitions,
  daysInStatus,
  fundingCommitment,
  isTerminal,
} from "@/domain/workflow";
import { postingTotalHours } from "@/domain/types";

const actor = contextFor("board");

export default function BoardPage() {
  const board = repositories.organizations.find(actor, actor.membership.organizationId!)!;
  const market = repositories.markets.find(actor, actor.membership.marketId!)!;

  const applications = repositories.applications.list(actor);
  const committed = applications
    .filter((a) => !isTerminal(a.status))
    .reduce((sum, a) => sum + fundingCommitment(a), 0);
  const remaining = market.subsidyBudget - committed;
  const burnPct = Math.round((committed / market.subsidyBudget) * 100);

  // Everything sitting on this board's desk
  const awaitingInterview = applications.filter(
    (a) => a.status === "interview_scheduled",
  );
  const awaitingDetermination = applications.filter(
    (a) => a.status === "interview_completed",
  );
  const awaitingFunding = applications.filter((a) => a.status === "cleared");
  const unbooked = applications.filter(
    (a) => a.status === "mutual_interest" && a.track === "standard",
  );

  const slots = repositories.interviewSlots.list(actor);
  const openSlots = slots.filter((s) => s.bookedByStudentId === null);

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 space-y-8">
      <PageHeader
        eyebrow="Local workforce board"
        title={board.name}
        subtitle={`${market.name} · ${market.programYear}`}
        action={
          <Button variant="dark">
            <span className="flex items-center gap-1.5">
              <CalendarPlus className="w-4 h-4" aria-hidden="true" /> Publish slots
            </span>
          </Button>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* The allocation is finite, so burn is the board's headline number    */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <span className="w-11 h-11 rounded-2xl bg-brand-500 text-white flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-black text-ink-950">
                {market.programYear} wage reimbursement allocation
              </h2>
              <p className="text-sm text-ink-500 mt-0.5">
                Committed at ${market.subsidyRatePerHour}/hour across active placements
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black text-ink-950 tabular">
              <Money value={remaining} />
            </p>
            <p className="text-xs text-ink-500 mt-0.5">
              uncommitted of <Money value={market.subsidyBudget} />
            </p>
          </div>
        </div>
        <div className="mt-5">
          <ProgressBar
            value={committed}
            max={market.subsidyBudget}
            tone={burnPct > 80 ? "crit" : burnPct > 60 ? "warn" : "brand"}
          />
          <div className="flex justify-between text-xs text-ink-500 mt-1.5">
            <span>
              <Money value={committed} /> committed ({burnPct}%)
            </span>
            <span className="tabular">
              ≈ {Math.floor(remaining / (market.subsidyRatePerHour * 210))} more full
              placements
            </span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Never booked"
          value={String(unbooked.length)}
          hint="Mutual interest, no interview scheduled"
          tone={unbooked.length > 0 ? "crit" : "good"}
        />
        <Stat label="Interviews booked" value={String(awaitingInterview.length)} />
        <Stat
          label="Awaiting determination"
          value={String(awaitingDetermination.length)}
          tone={awaitingDetermination.length > 0 ? "warn" : "neutral"}
        />
        <Stat
          label="Awaiting funding call"
          value={String(awaitingFunding.length)}
          tone={awaitingFunding.length > 0 ? "warn" : "neutral"}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Students who reached mutual interest and never booked               */}
      {/* ------------------------------------------------------------------ */}
      {unbooked.length > 0 && (
        <Card className="border-crit-100 ring-1 ring-crit-100">
          <CardHeader
            icon={<ClipboardList className="w-5 h-5 text-crit-600" />}
            title="Reached mutual interest but never booked"
            subtitle="These placements are the most likely in the system to fall apart"
          />
          <ul className="divide-y divide-ink-100">
            {unbooked.map((application) => {
              const student = repositories.students.find(actor, application.studentId)!;
              const posting = repositories.postings.find(actor, application.postingId)!;
              const days = daysInStatus(application, DEMO_NOW);
              return (
                <li
                  key={application.id}
                  className="px-6 py-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold text-sm text-ink-950">
                      {student.name} ↔ {organizationName(posting.businessId)}
                    </p>
                    <p className="text-xs text-ink-500 mt-0.5">{posting.title}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <DwellBadge days={days} />
                    <Button size="sm" variant="dark">
                      Reach out
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Eligibility determinations and funding authorizations               */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          title="On your desk"
          subtitle="Every standard application gets its own interview and its own funding decision"
        />
        {[...awaitingInterview, ...awaitingDetermination, ...awaitingFunding].length ===
        0 ? (
          <Empty>Nothing waiting on the board.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-ink-100">
                <tr>
                  <Th>Student</Th>
                  <Th>Placement</Th>
                  <Th>State</Th>
                  <Th>Waiting</Th>
                  <Th>Commitment</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {[...awaitingInterview, ...awaitingDetermination, ...awaitingFunding].map(
                  (application) => {
                    const student = repositories.students.find(
                      actor,
                      application.studentId,
                    )!;
                    const posting = repositories.postings.find(
                      actor,
                      application.postingId,
                    )!;
                    const days = daysInStatus(application, DEMO_NOW);
                    // The proposed commitment: what the board would authorize
                    // if it approved the posting's full hours at market rate.
                    const hours = application.fundingAuthorizedHours ?? postingTotalHours(posting);
                    const rate = application.fundingAuthorizedRate ?? market.subsidyRatePerHour;
                    const commitment = hours * rate;
                    // Ask the state machine whether this would actually go
                    // through, rather than re-deriving affordability here and
                    // enabling a button the guard will refuse.
                    const canAuthorize = availableTransitions(actor, {
                      application: {
                        ...application,
                        fundingAuthorizedHours: hours,
                        fundingAuthorizedRate: rate,
                      },
                      student,
                      remainingBudget: remaining,
                      postingOwnerId: posting.businessId,
                    }).some((t) => t.to === "funding_authorized");
                    
                    return (
                      <tr key={application.id}>
                        <Td className="whitespace-nowrap">
                          <span className="font-semibold text-ink-950">
                            {student.name}
                          </span>
                          <span className="block text-xs text-ink-500">
                            {student.eligibility === "eligible"
                              ? "Cleared previously — needs clearing for this job"
                              : "No prior determination"}
                          </span>
                        </Td>
                        <Td>
                          <span className="whitespace-nowrap">{posting.title}</span>
                          <span className="block text-xs text-ink-500">
                            {organizationName(posting.businessId)}
                          </span>
                        </Td>
                        <Td>
                          <StatusBadge status={application.status} />
                        </Td>
                        <Td>
                          <DwellBadge days={days} />
                        </Td>
                        <Td className="whitespace-nowrap">
                          <span className={canAuthorize ? "text-ink-700" : "text-crit-700 font-semibold"}>
                            <Money value={commitment} />
                          </span>
                          <span className="block text-xs text-ink-500">
                            {hours} hrs × ${market.subsidyRatePerHour}
                          </span>
                        </Td>
                        <Td>
                          {application.status === "interview_scheduled" && (
                            <Button size="sm" variant="dark">
                              Record outcome
                            </Button>
                          )}
                          {application.status === "interview_completed" && (
                            <Button size="sm" variant="primary">
                              Determine eligibility
                            </Button>
                          )}
                          {application.status === "cleared" && (
                            <Button
                              size="sm"
                              variant={canAuthorize ? "primary" : "ghost"}
                              disabled={!canAuthorize}
                              title={
                                canAuthorize
                                  ? undefined
                                  : "Commitment exceeds the remaining allocation"
                              }
                            >
                              {canAuthorize ? "Authorize funding" : "Over budget"}
                            </Button>
                          )}
                        </Td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="px-6 pb-5 pt-4">
          <Assumption>
            Clearance is per applicant per job (Q2), so your interview volume tracks
            applications rather than students — a student pursuing three roles books three
            interviews. Funding is then authorized per placement against a finite
            allocation (Q20).
          </Assumption>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Slot calendar                                                       */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          icon={<CircleDollarSign className="w-5 h-5" />}
          title="Interview availability"
          subtitle={`${openSlots.length} open of ${slots.length} published — students book these directly`}
        />
        <div className="px-6 py-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {slots.map((slot) => {
            const bookedBy = slot.bookedByStudentId
              ? repositories.students.find(actor, slot.bookedByStudentId)
              : null;
            return (
              <div
                key={slot.id}
                className={`rounded-xl border p-4 ${
                  bookedBy ? "border-brand-200 bg-brand-50" : "border-ink-200 bg-white"
                }`}
              >
                <p className="text-sm font-bold text-ink-950">
                  {new Date(slot.startsAt).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <p className="text-xs text-ink-600 mt-0.5">
                  {new Date(slot.startsAt).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · {slot.durationMinutes} min · {slot.officerName}
                </p>
                <div className="mt-2">
                  {bookedBy ? (
                    <Badge tone="brand">{bookedBy.name}</Badge>
                  ) : (
                    <Badge tone="good">Open</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
