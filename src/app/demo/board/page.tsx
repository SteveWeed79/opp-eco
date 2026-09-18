import {
  CircleDollarSign,
  ClipboardList,
  Gavel,
  HandCoins,
  Wallet,
} from "lucide-react";
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
  PageSection,
  ProgressBar,
  Stat,
  StatusBadge,
  TableWrap,
  Td,
  Th,
  ToneCard,
} from "@/components/ui";
import { TransitionActions } from "@/components/TransitionActions";
import { AuthorizeFunding } from "./AuthorizeFunding";
import { boardTransition, publishSlots } from "./actions";
import { repositories } from "@/data/backend";
import { nameLookups } from "@/lib/names";
import { actorForPortal } from "@/auth/session";
import { PublishSlots } from "./PublishSlots";
import { unreviewedWeeksByApplication } from "@/services/timesheet";
import { reimbursementFor } from "@/domain/timesheet";
import { asOf } from "@/lib/clock";
import { availableTransitions, daysInStatus } from "@/domain/workflow";
import { postingTotalHours } from "@/domain/types";
import { marketFunding } from "@/lib/queries";
import { fundPurposeLabel } from "@/domain/funding";
import { AdjustAllocation } from "./AdjustAllocation";
import { adjustAllocation } from "./actions";

export default async function BoardPage() {
  const actor = await actorForPortal("board");
  // Frozen for the demonstration, real for a real programme — see `asOf`.
  const now = await asOf(actor);
  const { organizationName } = await nameLookups(actor);
  const unreviewedWeeks = await unreviewedWeeksByApplication(actor);
  const board = (await repositories.organizations.find(actor, actor.membership.organizationId!))!;
  const market = (await repositories.markets.find(actor, actor.membership.marketId!))!;

  const applications = await repositories.applications.list(actor);

  // Every student and posting this board can see, indexed once.
  //
  // The rows below each need both, and looking them up inside the render
  // would be a query per row against Postgres — the classic N+1, and here it
  // would also mean awaiting inside JSX, which is not a thing a component can
  // do. Safe as a flat map specifically because this is the board: only a
  // business is held at arm's length by `forApplication`, so for this actor a
  // listed student is the same record `find` would return.
  const [allStudents, allPostings] = await Promise.all([
    await repositories.students.list(actor),
    await repositories.postings.list(actor),
  ]);
  const studentById = new Map(allStudents.map((s) => [s.id, s]));
  const postingById = new Map(allPostings.map((p) => [p.id, p]));
  /**
   * The fund, not the market.
   *
   * Every figure below used to come from `market.subsidyBudget`, a number
   * written on the market and read in five places. It is now the balance of the
   * market's wage-subsidy fund, and it is `committed` from the commitment
   * ledger rather than re-summed from the applications — the two are no longer
   * the same total, because a placement that ran and finished has *spent* its
   * commitment where the old test counted it as freed.
   */
  const funding = await marketFunding(actor, market.id);
  const wage = funding.wage;
  const allocated = wage?.source.allocated ?? 0;
  const committed = wage?.committed ?? 0;
  const remaining = wage?.remaining ?? 0;
  const ratePerHour = wage?.source.ratePerHour ?? 0;
  // Guarded, because a market whose board is still in conversation has no fund
  // at all and this used to divide by zero the moment one was opened.
  const burnPct = allocated > 0 ? Math.round((committed / allocated) * 100) : 0;
  /** Funds in this market that are somebody else's money — the coordination. */
  const assistance = funding.balances.filter(
    (b) => b.source.purpose !== "wage_subsidy",
  );

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

  // Placements that have produced approved hours. `hoursApproved` is the
  // cached total the timesheet service maintains inside the transaction that
  // writes each entry, so this needs no per-row query.
  const claims = applications
    .filter((a) => a.track === "standard" && (a.hoursApproved ?? 0) > 0)
    .map((application) => ({
      application,
      posting: postingById.get(application.postingId)!,
      reimbursement: reimbursementFor(application, application.hoursApproved ?? 0),
    }))
    .sort((a, b) => b.reimbursement.amount - a.reimbursement.amount);

  const slots = await repositories.interviewSlots.list(actor);
  const openSlots = slots.filter((s) => s.bookedByStudentId === null);

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16 space-y-8">
      <PageHeader
        eyebrow="Local workforce board"
        title={board.name}
        subtitle={`${market.name} · ${market.programYear}`}
        action={<PublishSlots action={publishSlots} />}
      />

      {/* ------------------------------------------------------------------ */}
      {/* The allocation is finite, so burn is the board's headline number    */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <span className="w-11 h-11 rounded-card bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-e1 flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-black text-ink-950">
                {market.programYear} wage reimbursement allocation
              </h2>
              <p className="text-sm text-ink-500 mt-0.5">
                Committed at ${ratePerHour}/hour across active placements
              </p>
            </div>
          </div>
          <div className="text-right">
            <p
              className={`text-3xl font-black tabular ${
                remaining < 0 ? "text-crit-700" : "text-ink-950"
              }`}
            >
              <Money value={remaining} />
            </p>
            <p className="text-xs text-ink-500 mt-0.5">
              {remaining < 0 ? "overcommitted against" : "uncommitted of"}{" "}
              <Money value={allocated} />
            </p>
            {wage && (
              <div className="mt-2 flex justify-end">
                <AdjustAllocation
                  sourceId={wage.source.id}
                  fundName={wage.source.name}
                  allocated={wage.source.allocated}
                  ratePerHour={wage.source.ratePerHour}
                  committed={wage.committed}
                  action={adjustAllocation}
                />
              </div>
            )}
          </div>
        </div>
        <div className="mt-5">
          <ProgressBar
            value={committed}
            max={allocated}
                      label="Subsidy allocation committed"
            tone={burnPct > 80 ? "crit" : burnPct > 60 ? "warn" : "brand"}
          />
          <div className="flex justify-between text-xs text-ink-500 mt-1.5">
            <span>
              <Money value={committed} /> committed ({burnPct}%)
            </span>
            <span className="tabular">
              ≈ {ratePerHour > 0 ? Math.max(0, Math.floor(remaining / (ratePerHour * 210))) : 0} more full
              placements
            </span>
          </div>
          {wage?.overcommitted && (
            <p className="mt-3 text-xs text-crit-700">
              More is committed than this fund now holds. Nothing here is wrong —
              an allocation was reduced after commitments were made, and the
              shortfall is named rather than hidden.
            </p>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* The other money in this market.                                     */}
      {/*                                                                     */}
      {/* Not the board's, and that is exactly why it is on the board's page.  */}
      {/* A learner whose credit cost is covered by a foundation is a learner  */}
      {/* who can take a placement this board is reimbursing, and until these  */}
      {/* rows existed the two facts lived in different organizations' inboxes */}
      {/* with nothing connecting them. This is the coordination the venture   */}
      {/* says it provides, rendered.                                          */}
      {/* ------------------------------------------------------------------ */}
      {assistance.length > 0 && (
        <Card>
          <CardHeader
            level={2}
            icon={<HandCoins className="w-5 h-5" />}
            title="Other funds supporting these placements"
            subtitle="Not the board's money — what else is covering the costs around a placement it reimburses"
          />
          <ul className="row-list divide-y divide-line">
            {assistance.map((balance) => (
              <li
                key={balance.source.id}
                className="px-6 py-4 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-ink-950">
                      {balance.source.name}
                    </span>
                    <Badge tone="neutral">
                      {fundPurposeLabel(balance.source.purpose)}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {organizationName(balance.source.sponsorOrgId)} ·{" "}
                    {balance.liveCommitments} learner
                    {balance.liveCommitments === 1 ? "" : "s"} supported
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-ink-950 tabular">
                    <Money value={balance.remaining} /> left
                  </p>
                  <p className="text-xs text-ink-500">
                    of <Money value={balance.source.allocated} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
      {/* Zone 1 — decisions only this board can make                         */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Needs a decision"
        description="Nothing below moves without you: a student cannot start, and an employer cannot be reimbursed, until the board has determined eligibility and committed funding."
      >

      {/* ------------------------------------------------------------------ */}
      {/* Students who reached mutual interest and never booked               */}
      {/* ------------------------------------------------------------------ */}
      {unbooked.length > 0 && (
        <ToneCard tone="crit" elevation="floating">
          <CardHeader
            level={3}
            icon={<ClipboardList className="w-5 h-5 text-crit-600" />}
            title="Reached mutual interest but never booked"
            subtitle="These placements are the most likely in the system to fall apart"
          />
          <ul className="row-list divide-y divide-line">
            {unbooked.map((application) => {
              const student = studentById.get(application.studentId)!;
              const posting = postingById.get(application.postingId)!;
              const days = daysInStatus(application, now);
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
                    {/* Disabled with a reason rather than live with no handler.
                        Nudging a stalled pair is a real need and there is no
                        messaging path to do it through — and the board reaching
                        a learner directly would go around the college, which
                        owns that relationship and holds the consent. Saying
                        that is more useful than a button that swallows the
                        click. */}
                    <Button
                      size="sm"
                      variant="dark"
                      disabled
                      title="No messaging path yet. A nudge would go through the college, which owns the learner relationship."
                    >
                      Reach out
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </ToneCard>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Eligibility determinations and funding authorizations               */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          level={3}
          // The one card header in the product with no icon, which made the
          // most important queue on the page read as the least considered.
          icon={<Gavel className="w-5 h-5" />}
          title="On your desk"
          subtitle="Every standard application gets its own interview and its own funding decision"
        />
        {[...awaitingInterview, ...awaitingDetermination, ...awaitingFunding].length ===
        0 ? (
          <Empty>Nothing waiting on the board.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <Th>Student</Th>
                  <Th>Placement</Th>
                  <Th>State</Th>
                  <Th>Waiting</Th>
                  <Th>Commitment</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody className="row-list divide-y divide-line">
                {[...awaitingInterview, ...awaitingDetermination, ...awaitingFunding].map(
                  (application) => {
                    const student = studentById.get(application.studentId)!;
                    const posting = postingById.get(application.postingId)!;
                    const days = daysInStatus(application, now);
                    // The proposed commitment: what the board would authorize
                    // if it approved the posting's full hours at market rate.
                    const hours = application.fundingAuthorizedHours ?? postingTotalHours(posting);
                    const rate = application.fundingAuthorizedRate ?? ratePerHour;
                    const commitment = hours * rate;
                    // Ask the state machine whether this would actually go
                    // through, rather than re-deriving affordability here and
                    // enabling a button the guard will refuse. The proposed
                    // hours and rate are patched in so the budget guard sees
                    // the commitment it is being asked to approve.
                    const offered = availableTransitions(actor, {
                      application: {
                        ...application,
                        fundingAuthorizedHours: hours,
                        fundingAuthorizedRate: rate,
                      },
                      student,
                      remainingBudget: remaining,
                      postingOwnerId: posting.businessId,
                      unreviewedWeeks: unreviewedWeeks.get(application.id) ?? 0,
                    });
                    const canAuthorize = offered.some(
                      (t) => t.to === "funding_authorized",
                    );
                    // Everything else renders as an ordinary transition button.
                    const otherTransitions = offered.filter(
                      (t) => t.to !== "funding_authorized",
                    );

                    return (
                      <tr key={application.id}>
                        {/* The name holds its line; the note under it does not.
                            `whitespace-nowrap` on the whole cell forced a
                            45-character sentence onto one line and made this
                            the widest column in the table at 320px, which is
                            what pushed the action buttons off the card. */}
                        <Td className="align-top">
                          <span className="block font-semibold text-ink-950 whitespace-nowrap">
                            {student.name}
                          </span>
                          <span className="block text-xs text-ink-500 max-w-[11rem] text-pretty">
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
                            {hours} hrs × ${rate}
                          </span>
                        </Td>
                        {/* Bounded, and deliberately so.
                            Under auto table layout this column claimed its
                            max-content width — two ~200px buttons laid side by
                            side — which pushed the table past the card and
                            sheared the labels off mid-word at the edge. A
                            fixed width is what lets the flex row inside
                            actually wrap, so the buttons stack instead. */}
                        <Td className="w-56 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Authorizing funding gets its own control: it
                                writes an hour cap against a finite allocation,
                                so the number has to be seen and confirmed
                                rather than assumed from a button press. */}
                            {canAuthorize && (
                              <AuthorizeFunding
                                applicationId={application.id}
                                studentName={student.name}
                                defaultHours={hours}
                                ratePerHour={rate}
                                remainingBudget={remaining}
                              />
                            )}
                            <TransitionActions
                              id={application.id}
                              action={boardTransition}
                              subject={`${student.name} — ${posting.title}`}
                              transitions={otherTransitions.map((t) => ({
                                to: t.to,
                                label: t.label,
                              }))}
                            />
                          </div>
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

      </PageSection>

      {/* ------------------------------------------------------------------ */}
      {/* Zone 2 — the money and the calendar. Reference the board reads,     */}
      {/* rather than queues it works, so it is named as a separate thing.    */}
      {/* ------------------------------------------------------------------ */}
      <PageSection
        title="Your allocation and calendar"
        description="What has been committed, what is being claimed against it, and the slots students are booking into."
      >

      {/* ------------------------------------------------------------------ */}
      {/* What is actually owed, against what was authorized                  */}
      {/*                                                                     */}
      {/* An authorization is a commitment; approved hours are a bill. They   */}
      {/* are different numbers and the gap between them is the board's real  */}
      {/* exposure — money committed against placements that may never work   */}
      {/* the hours, and hours worked beyond what was committed.              */}
      {/* ------------------------------------------------------------------ */}
      {claims.length > 0 && (
        <Card>
          <CardHeader
            level={3}
            icon={<CircleDollarSign className="w-5 h-5" />}
            title="Reimbursement against authorization"
            subtitle="Hours the supervising employer has signed off, priced at the authorized rate"
          />
          <TableWrap>
            {/* Named, so it is reachable and announced as itself rather than
                as the third unlabelled table on the page. */}
            <table className="w-full text-sm" aria-label="Reimbursement against authorization">
              <thead>
                <tr>
                  <Th>Placement</Th>
                  <Th>Approved</Th>
                  <Th>Authorized</Th>
                  <Th>Reimbursable</Th>
                </tr>
              </thead>
              <tbody>
                {claims.map(({ application, posting, reimbursement }) => (
                  <tr key={application.id} className="border-t border-line">
                    <Td>
                      <span className="font-semibold text-ink-950">
                        {posting.title}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {organizationName(posting.businessId)}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular">{reimbursement.approvedHours} hrs</span>
                    </Td>
                    <Td>
                      <span className="tabular text-ink-600">
                        {reimbursement.authorizedHours} hrs
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular font-bold text-ink-950">
                        <Money value={reimbursement.amount} />
                      </span>
                      {/* Named rather than netted off silently. Someone bears
                          this cost and it is the employer — a board that
                          quietly paid past its cap would overspend the
                          allocation, and one that quietly dropped the hours
                          would hide a bill an employer is about to eat. */}
                      {reimbursement.overCap && (
                        <span className="block text-xs text-warn-700 font-semibold mt-0.5">
                          {reimbursement.unreimbursedHours} hrs past the cap — not
                          reimbursable
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="px-6 py-4">
            <Assumption>
              Hours are approved by the supervising employer, who is the party
              that can attest the student was there. This board sees the hours
              and the periods; it does not see what the student worked on, which
              it has no need of to price a claim.
            </Assumption>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Slot calendar                                                       */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader
          level={3}
          icon={<CircleDollarSign className="w-5 h-5" />}
          title="Interview availability"
          subtitle={`${openSlots.length} open of ${slots.length} published — students book these directly`}
        />
        <div className="px-6 py-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {slots.map((slot) => {
            const bookedBy = slot.bookedByStudentId
              ? (studentById.get(slot.bookedByStudentId) ?? null)
              : null;
            return (
              <div
                key={slot.id}
                className={`rounded-xl border p-4 ${
                  bookedBy ? "border-brand-200 bg-brand-50" : "border-line-strong bg-white"
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
      </PageSection>
    </div>
  );
}
